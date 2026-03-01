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
    const appPath = app.getAppPath();
    return path.join(appPath, 'resources', 'tools');
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
