import { stat } from 'fs/promises'
import { getBundledGitShellPath } from '@work-agent/shared/tools'

/**
 * Basic file-name validation for Git Bash executable paths.
 * Accepts Windows-style and POSIX-style separators to support cross-platform tests.
 * We allow both `bash.exe` and MinGit's bundled `sh.exe`.
 */
export function isGitBashExecutablePath(filePath: string): boolean {
  return /(?:^|[\\/])(?:bash|sh)\.exe$/i.test(filePath.trim())
}

/**
 * Validate a user-provided Git Bash executable path.
 * Enforces bash.exe filename and existence on disk.
 */
export async function validateGitBashPath(filePath: string): Promise<{ valid: true; path: string } | { valid: false; error: string }> {
  const trimmedPath = filePath.trim()

  if (!isGitBashExecutablePath(trimmedPath)) {
    return { valid: false, error: 'Path must point to bash.exe or sh.exe' }
  }

  try {
    const info = await stat(trimmedPath)
    if (!info.isFile()) {
      return { valid: false, error: 'Path must point to a file' }
    }
    return { valid: true, path: trimmedPath }
  } catch {
    return { valid: false, error: 'File does not exist at the specified path' }
  }
}

/**
 * Check if a Git Bash path is usable without returning UI-facing errors.
 */
export async function isUsableGitBashPath(filePath: string): Promise<boolean> {
  const result = await validateGitBashPath(filePath)
  return result.valid
}

/**
 * Resolve the bundled MinGit shell path when available.
 */
export async function getBundledUsableGitBashPath(): Promise<string | null> {
  const bundledPath = getBundledGitShellPath()
  if (!bundledPath) {
    return null
  }

  return (await isUsableGitBashPath(bundledPath)) ? bundledPath : null
}
