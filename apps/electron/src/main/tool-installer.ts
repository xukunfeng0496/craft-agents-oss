// apps/electron/src/main/tool-installer.ts
import { createWriteStream, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { IncomingMessage } from 'http'
import { shell } from 'electron'
import { execFile } from 'child_process'
import type { ToolInstallProgress } from '../shared/types'

/** Hardcoded stable Python version (update periodically) */
const PYTHON_VERSION = '3.12.8'

export interface ToolInstallInfo {
  downloadUrl: string
  filename: string
  sizeMB: number
  version: string
}

/**
 * Fetch the latest Git for Windows release info from GitHub API.
 */
async function fetchGitForWindowsInfo(): Promise<ToolInstallInfo> {
  const resp = await fetch(
    'https://api.github.com/repos/git-for-windows/git/releases/latest',
    { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'craft-agents' } }
  )
  const data = await resp.json() as {
    tag_name: string
    assets: Array<{ name: string; browser_download_url: string; size: number }>
  }
  const asset = data.assets.find(a => /Git-[\d.]+-64-bit\.exe$/.test(a.name))
  if (!asset) throw new Error('Could not find Git for Windows 64-bit installer asset')

  return {
    downloadUrl: asset.browser_download_url,
    filename: asset.name,
    sizeMB: Math.round(asset.size / 1024 / 1024),
    version: data.tag_name.replace(/^v/, ''),
  }
}

/**
 * Get install info for a tool on the current platform.
 * Returns null for tools that don't need a download (e.g., macOS git via xcode-select).
 */
export async function getToolInstallInfo(toolId: 'git' | 'python'): Promise<ToolInstallInfo | null> {
  const p = process.platform

  if (toolId === 'git') {
    if (p === 'win32') return fetchGitForWindowsInfo()
    // macOS: use xcode-select, no download
    return null
  }

  // Python
  if (p === 'win32') {
    return {
      downloadUrl: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`,
      filename: `python-${PYTHON_VERSION}-amd64.exe`,
      sizeMB: 28,
      version: PYTHON_VERSION,
    }
  }

  // macOS
  return {
    downloadUrl: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-macos11.pkg`,
    filename: `python-${PYTHON_VERSION}-macos11.pkg`,
    sizeMB: 44,
    version: PYTHON_VERSION,
  }
}

type ProgressCallback = (p: Omit<ToolInstallProgress, 'toolId' | 'status'> & { status: 'downloading' }) => void

/**
 * Stream-download a file to a temp path, emitting progress events.
 * Follows HTTP 3xx redirects.
 */
function downloadFile(url: string, destPath: string, onProgress: ProgressCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https://') ? https.get : http.get

    get(url, (res: IncomingMessage) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject)
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10)
      let downloadedBytes = 0
      const file = createWriteStream(destPath)

      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        if (totalBytes > 0) {
          onProgress({
            status: 'downloading',
            percent: Math.round((downloadedBytes / totalBytes) * 100),
            downloadedMB: Math.round((downloadedBytes / 1024 / 1024) * 10) / 10,
            totalMB: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
          })
        }
      })

      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', err => {
        if (existsSync(destPath)) unlinkSync(destPath)
        reject(err)
      })
    }).on('error', reject)
  })
}

/**
 * Download and launch the installer for a tool.
 * Calls onProgress with download/launch status events.
 * Resolves when the installer has been launched (not when installation finishes).
 */
export async function installTool(
  toolId: 'git' | 'python',
  onProgress: (p: Omit<ToolInstallProgress, 'toolId'>) => void,
): Promise<{ launched: boolean; error?: string }> {
  const p = process.platform

  // macOS git: trigger Xcode CLI Tools system dialog (no download)
  if (toolId === 'git' && p === 'darwin') {
    return new Promise(resolve => {
      execFile('xcode-select', ['--install'], err => {
        // Error code 1 with "already installed" message is fine
        if (err && !err.message.includes('already installed') && !err.message.includes('command line tools are already installed')) {
          resolve({ launched: false, error: err.message })
        } else {
          onProgress({ status: 'done' })
          resolve({ launched: true })
        }
      })
    })
  }

  // Get download info
  let info: ToolInstallInfo | null
  try {
    info = await getToolInstallInfo(toolId)
  } catch (err) {
    return { launched: false, error: `Failed to get download info: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!info) {
    return { launched: false, error: 'No installer available for this platform' }
  }

  // Download
  const destPath = join(tmpdir(), info.filename)
  try {
    await downloadFile(info.downloadUrl, destPath, onProgress)
  } catch (err) {
    return { launched: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Launch installer
  onProgress({ status: 'launching' })
  await shell.openPath(destPath)
  onProgress({ status: 'done' })

  return { launched: true }
}
