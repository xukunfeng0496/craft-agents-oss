/**
 * Tests for cleanupOldUpdateCache's version-based deletion logic.
 *
 * Bug being guarded: the cache cleanup used a strict `!==` check against the
 * current app version, so a downloaded-but-not-yet-installed NEWER update
 * (e.g. running 0.11.2, already downloaded 0.11.3, user hasn't restarted in
 * >24h) got deleted on next launch — silently discarding a completed download.
 * The fix compares versions with semver ordering and additionally never
 * deletes the version recorded as pending in update-info.json.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let cacheDir: string

mock.module('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? cacheDir : tmpdir()),
    getVersion: () => '0.11.2',
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

mock.module('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    forceDevUpdateConfig: false,
    logger: undefined,
    on: () => {},
    checkForUpdates: async () => undefined,
    quitAndInstall: () => {},
  },
}))

mock.module('../logger', () => {
  const stubLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    autoUpdateLog: stubLog,
  }
})

const { cleanupOldUpdateCache } = await import('../auto-update')

// getUpdateCacheDir() derives the platform-specific cache path from
// app.getPath('home'); on darwin (the CI/dev platform for this repo) that's
// `<home>/Library/Caches/<pkgName>-updater/pending`.
function resolvePendingDir(home: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgName: string = require('../../../package.json').name
  const sanitized = pkgName.replace(/\//g, '')
  return join(home, 'Library', 'Caches', `${sanitized}-updater`, 'pending')
}

async function flushSetImmediate(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

describe('cleanupOldUpdateCache', () => {
  let pendingDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'auto-update-cache-'))
    pendingDir = resolvePendingDir(cacheDir)
    require('fs').mkdirSync(pendingDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  function writeOldFile(name: string): string {
    const filePath = join(pendingDir, name)
    writeFileSync(filePath, 'stub-binary')
    // Backdate mtime so it clears the "avoid cleaning in-progress downloads" guard.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    require('fs').utimesSync(filePath, twoDaysAgo, twoDaysAgo)
    return filePath
  }

  it('does not delete a downloaded newer-version cache file (current 0.11.2, cached 0.11.3)', async () => {
    const newerFile = writeOldFile('Work-Agent-0.11.3-osx-arm64.dmg')

    cleanupOldUpdateCache()
    await flushSetImmediate()

    expect(existsSync(newerFile)).toBe(true)
  })

  it('still deletes a stale older-version cache file (current 0.11.2, cached 0.11.1)', async () => {
    const olderFile = writeOldFile('Work-Agent-0.11.1-osx-arm64.dmg')

    cleanupOldUpdateCache()
    await flushSetImmediate()

    expect(existsSync(olderFile)).toBe(false)
  })

  it('never deletes the version recorded as pending in update-info.json even if not newer', async () => {
    // Edge case: pending version happens to equal current version's file naming
    // collision aside, this guards the explicit pendingVersion exclusion path.
    const pendingFile = writeOldFile('Work-Agent-0.11.1-osx-arm64.dmg')
    writeFileSync(join(pendingDir, 'update-info.json'), JSON.stringify({ version: '0.11.1' }))

    cleanupOldUpdateCache()
    await flushSetImmediate()

    expect(existsSync(pendingFile)).toBe(true)
  })
})
