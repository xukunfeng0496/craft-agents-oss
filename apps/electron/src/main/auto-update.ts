/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. When AUTO_UPDATE_SERVER_URL is configured, updates
 * are fetched from fast-update-server via the generic provider; otherwise the
 * packaged GitHub Releases provider remains as fallback.
 *
 * Platform behavior:
 * - macOS: Downloads zip, extracts and swaps app bundle atomically
 * - Windows: Downloads NSIS installer, runs silently on quit
 * - Linux: Downloads AppImage, replaces current file
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 * quitAndInstall() handles restart natively — no external scripts.
 */

import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { platform } from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { mainLog } from './logger'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { readJsonFileSync } from '@craft-agent/shared/utils/files'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport' 

// Platform detection
const PLATFORM = platform()
const IS_MAC = PLATFORM === 'darwin'
const IS_WINDOWS = PLATFORM === 'win32'
const AUTO_UPDATE_SERVER_URL = process.env.AUTO_UPDATE_SERVER_URL?.trim() || ''
const AUTO_UPDATE_PRODUCT_ID = process.env.AUTO_UPDATE_PRODUCT_ID?.trim() || 'work-agents'
const AUTO_UPDATE_CHANNEL = process.env.AUTO_UPDATE_CHANNEL?.trim() || 'stable'
const SILENT_UPDATE_MODE = process.env.AUTO_UPDATE_SILENT !== '0'
const DEV_AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE_ENABLE_DEV === '1'
const FAST_UPDATE_PLATFORM = `${PLATFORM}-${process.arch}`

function joinUrl(base: string, ...parts: string[]): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedParts = parts.map((part) => part.replace(/^\/+|\/+$/g, ''))
  return [normalizedBase, ...normalizedParts].join('/')
}

const FAST_UPDATE_FEED_URL = AUTO_UPDATE_SERVER_URL
  ? joinUrl(
      AUTO_UPDATE_SERVER_URL,
      'api',
      'v1',
      encodeURIComponent(AUTO_UPDATE_PRODUCT_ID),
      'download',
      encodeURIComponent(AUTO_UPDATE_CHANNEL),
    )
  : null

const FAST_UPDATE_CHECK_URL = AUTO_UPDATE_SERVER_URL
  ? joinUrl(
      AUTO_UPDATE_SERVER_URL,
      'api',
      'v1',
      encodeURIComponent(AUTO_UPDATE_PRODUCT_ID),
      'check',
      encodeURIComponent(AUTO_UPDATE_CHANNEL),
    )
  : null

interface FastUpdateCheckResponse {
  updateAvailable: boolean
  version?: string
  releaseDate?: string
  releaseNotes?: string
  path?: string
  sha512?: string
  size?: number
  files?: Array<{
    url?: string
    size?: number
    sha512?: string
  }>
}

function isSquirrelCodeSignError(error: Error): boolean {
  return IS_MAC && error.message.includes('SQRLCodeSignatureErrorDomain')
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function getGitHubReleaseUrl(version: string | null): string {
  const base = 'https://github.com/xukunfeng0496/craft-agents-oss/releases'
  return version ? `${base}/tag/v${version}` : `${base}/latest`
}

function getManualDownloadUrl(version: string | null, relativePath?: string | null): string {
  if (FAST_UPDATE_FEED_URL) {
    const baseUrl = version ? getFastUpdateVersionedFeedUrl(version) : FAST_UPDATE_FEED_URL
    if (!relativePath) {
      return baseUrl
    }

    try {
      return new URL(relativePath, ensureTrailingSlash(baseUrl)).toString()
    } catch {
      return baseUrl
    }
  }

  return getGitHubReleaseUrl(version)
}

function getReleaseUrlFromInfo(
  info: { version?: string; path?: string; files?: Array<{ url?: string }> } | null | undefined,
): string | undefined {
  if (!info) return undefined
  const relativePath = info.files?.[0]?.url || info.path
  return getManualDownloadUrl(info.version ?? null, relativePath)
}

function getFastUpdateVersionedFeedUrl(version: string): string {
  if (!FAST_UPDATE_FEED_URL) {
    throw new Error('FAST_UPDATE_FEED_URL is not configured')
  }

  return joinUrl(FAST_UPDATE_FEED_URL, encodeURIComponent(version))
}

async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '', 10)
        const delay = (retryAfter > 0 ? retryAfter : Math.pow(2, attempt)) * 1000
        mainLog.warn(`[auto-update] Rate limited (429), retry in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`)
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delay))
          continue
        }
      }
      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        mainLog.warn(`[auto-update] Network error, retry in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted all retries')
}

async function fetchFastUpdateCheck(currentVersion: string): Promise<FastUpdateCheckResponse> {
  if (!FAST_UPDATE_CHECK_URL) {
    throw new Error('FAST_UPDATE_CHECK_URL is not configured')
  }

  const url = new URL(FAST_UPDATE_CHECK_URL)
  url.searchParams.set('platform', FAST_UPDATE_PLATFORM)
  url.searchParams.set('version', currentVersion)

  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`fast-update-server check failed: ${response.status} ${response.statusText}`)
  }

  return await response.json() as FastUpdateCheckResponse
}

// Get the update cache directory path (for file watcher fallback on macOS)
// electron-updater uses these paths:
// - Windows: %LOCALAPPDATA%/{sanitizedAppName}-updater/pending
// - macOS: ~/Library/Caches/{sanitizedAppName}-updater/pending
// - Linux: ~/.cache/{sanitizedAppName}-updater/pending
// NOTE: electron-updater uses the sanitized package name (with '/' removed), NOT app.getName()
// For "@work-agent/electron" → "@work-agentelectron-updater"
function getUpdateCacheDir(): string {
  // electron-updater sanitizes the app name by removing '/' characters
  // We need to use the package name, not the product name (app.getName() returns productName)
  // Derive dynamically to stay in sync if the package name ever changes
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgName: string = require('../../package.json').name
  const sanitizedAppName = pkgName.replace(/\//g, '')
  if (IS_MAC) {
    return path.join(app.getPath('home'), 'Library', 'Caches', `${sanitizedAppName}-updater`, 'pending')
  } else if (IS_WINDOWS) {
    // Windows uses LOCALAPPDATA, not APPDATA (roaming)
    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
    return path.join(localAppData, `${sanitizedAppName}-updater`, 'pending')
  } else {
    // Linux
    return path.join(app.getPath('home'), '.cache', `${sanitizedAppName}-updater`, 'pending')
  }
}

/**
 * Clean up old cached update files to free disk space.
 * Removes installer files from versions older than the current app version.
 * Safe to call on app launch - runs asynchronously without blocking.
 */
export function cleanupOldUpdateCache(): void {
  // Run asynchronously to not block app launch
  setImmediate(() => {
    try {
      const cacheDir = getUpdateCacheDir()
      if (!fs.existsSync(cacheDir)) {
        return
      }

      const currentVersion = app.getVersion()
      const files = fs.readdirSync(cacheDir)
      let cleanedCount = 0
      let cleanedBytes = 0

      for (const file of files) {
        // Skip metadata files that electron-updater manages
        if (file === 'update-info.json' || file.endsWith('.yml')) {
          continue
        }

        // Check if file is from an older version (filename contains version number)
        const versionMatch = file.match(/(\d+\.\d+\.\d+)/)
        if (versionMatch && versionMatch[1] !== currentVersion) {
          const filePath = path.join(cacheDir, file)
          try {
            const stats = fs.statSync(filePath)
            // Only clean files older than 1 day (avoid cleaning in-progress downloads)
            const oneDayMs = 24 * 60 * 60 * 1000
            if (Date.now() - stats.mtimeMs > oneDayMs) {
              fs.rmSync(filePath, { force: true })
              cleanedCount++
              cleanedBytes += stats.size
              mainLog.info(`[auto-update] Cleaned old cache: ${file}`)
            }
          } catch {
            // Ignore individual file cleanup errors
          }
        }
      }

      if (cleanedCount > 0) {
        const mbFreed = (cleanedBytes / (1024 * 1024)).toFixed(1)
        mainLog.info(`[auto-update] Cache cleanup: removed ${cleanedCount} file(s), freed ${mbFreed} MB`)
      }
    } catch (error) {
      mainLog.warn('[auto-update] Cache cleanup failed:', error)
    }
  })
}

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  silentMode: SILENT_UPDATE_MODE,
  currentVersion: app.getVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
  supportsProgress: true, // electron-updater v6.8.0+ supports progress on all platforms
}

let eventSink: EventSink | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false

// Hook fired immediately before quitAndInstall, while BrowserWindows still exist.
// electron-updater destroys windows between quitAndInstall and before-quit firing,
// so the regular before-quit save site would see an empty array.
let beforeUpdateQuitHook: (() => void) | null = null

/**
 * Register a callback to run inside installUpdate() before quitAndInstall.
 * Used by index.ts to snapshot multi-window state while windows are still alive.
 */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
}

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Auto-download updates in the background after detection
autoUpdater.autoDownload = true

// Install on app quit (if update is downloaded but user hasn't clicked "Restart")
autoUpdater.autoInstallOnAppQuit = true

// Allow opt-in dev verification when a feed URL is configured.
autoUpdater.forceDevUpdateConfig = DEV_AUTO_UPDATE_ENABLED

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

if (FAST_UPDATE_FEED_URL) {
  mainLog.info(`[auto-update] Using fast-update-server compatibility mode (${FAST_UPDATE_CHECK_URL})`)
} else {
  mainLog.info('[auto-update] Using packaged provider configuration')
}

if (DEV_AUTO_UPDATE_ENABLED) {
  mainLog.info('[auto-update] Development update checks enabled via AUTO_UPDATE_ENABLE_DEV=1')
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', (info) => {
  mainLog.info(`[auto-update] Update available: ${updateInfo.currentVersion} → ${info.version}`)
  const releaseUrl = getReleaseUrlFromInfo(info)

  // First, check electron-updater's internal state (most reliable)
  const internalState = checkElectronUpdaterState()
  if (internalState.ready) {
    mainLog.info(`[auto-update] electron-updater reports download ready`)
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: info.version,
      downloadState: 'ready',
      downloadProgress: 100,
      releaseUrl,
      error: undefined,
    }
    broadcastUpdateInfo()
    return
  }

  // Fallback: check if file exists in cache directory
  const existing = checkForExistingDownload(info.version)
  if (existing.exists) {
    mainLog.info(`[auto-update] Update already downloaded (file check), setting state to ready`)
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: info.version,
      downloadState: 'ready',
      downloadProgress: 100,
      releaseUrl,
      error: undefined,
    }
    broadcastUpdateInfo()
    return
  }

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'downloading',
    downloadProgress: 0,
    releaseUrl,
    error: undefined,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
    downloadProgress: 0,
    releaseUrl: undefined,
    error: undefined,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', async (info) => {
  mainLog.info(`[auto-update] Update downloaded: v${info.version}`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'ready',
    downloadProgress: 100,
    releaseUrl: getReleaseUrlFromInfo(info),
    error: undefined,
  }
  broadcastUpdateInfo()

  // Rebuild menu to show "Install Update..." option
  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
})

autoUpdater.on('error', (error) => {
  mainLog.error('[auto-update] Error:', error.message)

  // If download already completed successfully, don't let post-download errors
  // (e.g. Squirrel.Mac bundle extraction in dev mode) override the 'ready' state.
  // The file is cached and autoInstallOnAppQuit can still use it.
  if (updateInfo.downloadState === 'ready') {
    mainLog.info('[auto-update] Ignoring post-download error (state remains ready):', error.message)
    return
  }

  if (isSquirrelCodeSignError(error)) {
    mainLog.info('[auto-update] Squirrel code signature error — switching to manual-download state')
    updateInfo = {
      ...updateInfo,
      downloadState: 'manual-download',
      releaseUrl: updateInfo.releaseUrl || getManualDownloadUrl(updateInfo.latestVersion),
      error: error.message,
    }
  } else {
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error.message,
    }
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Check if electron-updater already has a validated download ready.
 * This uses electron-updater's internal state which is more reliable than file checks.
 */
function checkElectronUpdaterState(): { ready: boolean; version?: string } {
  try {
    // Access electron-updater's internal downloadedUpdateHelper
    // @ts-expect-error - accessing internal API for reliability
    const helper = autoUpdater.downloadedUpdateHelper
    if (helper) {
      mainLog.info(`[auto-update] downloadedUpdateHelper exists, cacheDir: ${helper.cacheDir}`)
      // @ts-expect-error - accessing internal API
      const versionInfo = helper.versionInfo
      if (versionInfo) {
        mainLog.info(`[auto-update] electron-updater has validated download: ${JSON.stringify(versionInfo)}`)
        return { ready: true, version: versionInfo.version }
      }
    }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking electron-updater state:', error)
  }
  return { ready: false }
}

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true) */
  autoDownload?: boolean
}

/**
 * Check if a downloaded update already exists in the cache directory.
 * This helps detect updates that were downloaded in a previous session.
 */
function checkForExistingDownload(expectedVersion?: string): { exists: boolean; version?: string } {
  try {
    const cacheDir = getUpdateCacheDir()
    mainLog.info(`[auto-update] Checking cache directory: ${cacheDir}`)

    if (!fs.existsSync(cacheDir)) {
      mainLog.info(`[auto-update] Cache directory does not exist`)
      return { exists: false }
    }

    const files = fs.readdirSync(cacheDir)
    mainLog.info(`[auto-update] Files in cache: ${JSON.stringify(files)}`)

    // Look for update info file that electron-updater creates
    const updateInfoFile = files.find(f => f === 'update-info.json')
    if (updateInfoFile) {
      const infoPath = path.join(cacheDir, updateInfoFile)
      const info = readJsonFileSync(infoPath) as Record<string, unknown> | null
      mainLog.info(`[auto-update] update-info.json contents: ${JSON.stringify(info)}`)

      // electron-updater uses 'fileName' (not 'path') in update-info.json
      const fileName = (info?.fileName || info?.path) as string | undefined
      const version = info?.version as string | undefined
      const matchesExpectedVersion = !expectedVersion ||
        version === expectedVersion ||
        (typeof fileName === 'string' && fileName.includes(expectedVersion))

      if (fileName && fs.existsSync(path.join(cacheDir, fileName)) && matchesExpectedVersion) {
        mainLog.info(`[auto-update] Found existing download via update-info.json: ${fileName}`)
        return { exists: true, version }
      }

      if (fileName && fs.existsSync(path.join(cacheDir, fileName)) && !matchesExpectedVersion) {
        mainLog.info(
          `[auto-update] Ignoring stale cached download via update-info.json: ${fileName} (expected ${expectedVersion ?? 'any'})`,
        )
      }
    }

    // Fallback: check for any installer/zip/dmg file
    const downloadFile = files.find(f =>
      (!expectedVersion || f.includes(expectedVersion)) &&
      (
      f.endsWith('.zip') ||
      f.endsWith('.exe') ||
      f.endsWith('.AppImage') ||
      f.endsWith('.dmg') ||
      f.endsWith('.nupkg')
      )
    )
    if (downloadFile) {
      mainLog.info(`[auto-update] Found existing download file: ${downloadFile}`)
      return { exists: true }
    }

    mainLog.info(`[auto-update] No existing download found in cache`)
    return { exists: false }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking for existing download:', error)
    return { exists: false }
  }
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  const { autoDownload = true } = options

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    if (FAST_UPDATE_FEED_URL && FAST_UPDATE_CHECK_URL) {
      const remoteInfo = await fetchFastUpdateCheck(updateInfo.currentVersion)

      if (!remoteInfo.updateAvailable || !remoteInfo.version) {
        mainLog.info(`[auto-update] fast-update-server reports no update for ${FAST_UPDATE_PLATFORM}`)
        updateInfo = {
          ...updateInfo,
          available: false,
          latestVersion: updateInfo.currentVersion,
          downloadState: 'idle',
          downloadProgress: 0,
          releaseUrl: undefined,
          error: undefined,
        }
        broadcastUpdateInfo()
        return getUpdateInfo()
      }

      const versionedFeedUrl = getFastUpdateVersionedFeedUrl(remoteInfo.version)
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: versionedFeedUrl,
      })
      mainLog.info(
        `[auto-update] fast-update-server update ${remoteInfo.version} available for ${FAST_UPDATE_PLATFORM} via ${versionedFeedUrl}`,
      )
      updateInfo = {
        ...updateInfo,
        available: true,
        latestVersion: remoteInfo.version,
        releaseUrl: getReleaseUrlFromInfo(remoteInfo),
        error: undefined,
      }
    }

    // Check for updates - this returns a promise that resolves with the check result
    const result = await autoUpdater.checkForUpdates()

    // If update is available and was already downloaded, the update-downloaded event
    // should fire. Wait a moment for events to settle before returning.
    if (result?.updateInfo) {
      // Give electron-updater time to fire update-downloaded if file exists
      await new Promise(resolve => setTimeout(resolve, 500))

      // Double-check: if we're still showing 'downloading' but file exists, update state
      if (updateInfo.downloadState === 'downloading') {
        const existing = checkForExistingDownload(result.updateInfo.version)
        if (existing.exists) {
          mainLog.info('[auto-update] Update already downloaded, updating state to ready')
          updateInfo = {
            ...updateInfo,
            downloadState: 'ready',
            downloadProgress: 100,
          }
          broadcastUpdateInfo()
        }
      }
    }
  } catch (error) {
    mainLog.error('[auto-update] Check failed:', error)
    const err = error instanceof Error ? error : new Error('Check failed')
    if (isSquirrelCodeSignError(err)) {
      updateInfo = {
        ...updateInfo,
        downloadState: 'manual-download',
        releaseUrl: updateInfo.releaseUrl || getManualDownloadUrl(updateInfo.latestVersion),
        error: err.message,
      }
    } else {
      updateInfo = {
        ...updateInfo,
        downloadState: 'error',
        error: err.message,
      }
    }
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

/**
 * Install the downloaded update and restart the app.
 * Calls electron-updater's quitAndInstall which handles:
 * - macOS: Extracts zip and swaps app bundle
 * - Windows: Runs NSIS installer silently
 * - Linux: Replaces AppImage file
 * Then relaunches the app automatically.
 */
export async function installUpdate(): Promise<void> {
  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  mainLog.info('[auto-update] Installing update and restarting...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true

  // Diagnostic correlation with before-quit's [update-flow] log. If these
  // window counts diverge, electron-updater is destroying windows between
  // here and before-quit firing — confirms the multi-window restore bug.
  mainLog.info('[update-flow] installUpdate pre-quit', {
    electronWindowCount: BrowserWindow.getAllWindows().length,
    downloadState: updateInfo.downloadState,
    latestVersion: updateInfo.latestVersion,
  })

  // Snapshot window state BEFORE quitAndInstall — electron-updater destroys
  // BrowserWindows between this call and before-quit firing, so the regular
  // before-quit save would clobber window-state.json with an empty array.
  try {
    beforeUpdateQuitHook?.()
  } catch (err) {
    mainLog.error('[auto-update] beforeUpdateQuit hook failed:', err)
  }

  try {
    // Silent mode keeps the Windows installer hidden. Other platforms ignore
    // the flag and preserve the native install flow.
    autoUpdater.quitAndInstall(SILENT_UPDATE_MODE, true)
  } catch (error) {
    __isUpdating = false
    mainLog.error('[auto-update] quitAndInstall failed:', error)
    updateInfo = { ...updateInfo, downloadState: 'error' }
    broadcastUpdateInfo()
    throw error
  }
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}

export function shouldCheckForUpdatesOnLaunch(): boolean {
  return app.isPackaged || DEV_AUTO_UPDATE_ENABLED
}

/**
 * Check for updates on app launch.
 * - Cleans up old cache files first
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Auto-downloads if update available
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  // Clean up old cached update files from previous versions
  cleanupOldUpdateCache()

  mainLog.info('[auto-update] Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress — will notify when ready via update-downloaded event
  return { action: 'downloading', version: info.latestVersion }
}
