import path from 'node:path';

/**
 * Type for supported bundled tools
 */
export type BundledToolName = 'git' | 'python';

/**
 * Get the bundled tools directory path.
 * Only available on Windows and when running in Electron.
 * @returns The tools directory path, or null if not available
 */
function getBundledToolsDir(): string | null {
  // Only on Windows
  if (process.platform !== 'win32') {
    return null;
  }

  // Check if we're in Electron environment
  try {
    // Try to require electron - this will fail in test environment
    const electron = require('electron');
    const app = electron.app;

    if (!app) {
      return null;
    }

    // Get app path and construct tools directory
    // In packaged app: tools are in resources/tools (sibling to resources/app)
    // In dev: tools are in resources/tools relative to project root
    const appPath = app.getAppPath();
    if (app.isPackaged) {
      // Packaged: appPath is resources/app, tools are in resources/tools
      return path.join(path.dirname(appPath), 'tools');
    } else {
      // Dev: appPath is project root, tools are in resources/tools
      return path.join(appPath, 'resources', 'tools');
    }
  } catch {
    // Not in Electron environment (e.g., tests)
    return null;
  }
}

/**
 * Get the path to bundled Git executable.
 * Only available on Windows.
 * @returns Path to git.exe, or null if not available
 */
export function getBundledGitPath(): string | null {
  const toolsDir = getBundledToolsDir();
  if (!toolsDir) {
    return null;
  }

  return path.join(toolsDir, 'mingit', 'cmd', 'git.exe');
}

/**
 * Get additional PATH directories for bundled tools.
 * For MinGit, this includes usr/bin which contains sh.exe and other Unix tools.
 * Only available on Windows.
 * @returns Array of additional directories to add to PATH
 */
export function getBundledToolExtraPaths(): string[] {
  const toolsDir = getBundledToolsDir();
  if (!toolsDir) {
    return [];
  }

  // MinGit usr/bin contains sh.exe, dash.exe, and other Unix utilities
  const mingitUsrBin = path.join(toolsDir, 'mingit', 'usr', 'bin');

  return [mingitUsrBin];
}

/**
 * Get the path to bundled Python executable.
 * Only available on Windows.
 * @returns Path to python.exe, or null if not available
 */
export function getBundledPythonPath(): string | null {
  const toolsDir = getBundledToolsDir();
  if (!toolsDir) {
    return null;
  }

  return path.join(toolsDir, 'python', 'python.exe');
}

/**
 * Get the path to a bundled tool by name.
 * Only available on Windows.
 * @param toolName - Name of the tool ('git' or 'python')
 * @returns Path to the tool executable, or null if not available
 */
export function getBundledToolPath(toolName: BundledToolName): string | null {
  switch (toolName) {
    case 'git':
      return getBundledGitPath();
    case 'python':
      return getBundledPythonPath();
    default:
      return null;
  }
}
