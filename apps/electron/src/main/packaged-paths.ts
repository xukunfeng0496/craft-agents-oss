import { app } from 'electron'
import { join } from 'path'

/**
 * Path to the packaged app contents as seen by Electron.
 *
 * When ASAR is enabled, this points at `.../resources/app.asar`.
 * Electron's patched fs APIs can still read from this path.
 */
export function getPackagedContentPath(...segments: string[]): string {
  const basePath = app.isPackaged ? app.getAppPath() : process.cwd()
  return segments.length > 0 ? join(basePath, ...segments) : basePath
}

/**
 * Path to packaged files that must exist on the real filesystem.
 *
 * External runtimes like Bun, Node, PowerShell, and bundled CLIs cannot read
 * files from inside `app.asar`, so packaged subprocess entrypoints must resolve
 * through this helper instead of `app.getAppPath()`.
 */
export function getPackagedFilesystemPath(...segments: string[]): string {
  let basePath: string

  if (!app.isPackaged) {
    basePath = process.cwd()
  } else {
    const appPath = app.getAppPath()
    basePath = appPath.endsWith('.asar') ? join(process.resourcesPath, 'app') : appPath
  }

  return segments.length > 0 ? join(basePath, ...segments) : basePath
}
