// apps/electron/src/main/agent-env.ts
import { dirname } from 'path'
import type { ToolInfo } from '../shared/types'

/**
 * Build environment variables for agent execution with bundled tool paths.
 * Prepends directories containing bundled tools to PATH.
 *
 * @param toolInfo - Array of tool detection results
 * @param baseEnv - Base environment variables (defaults to process.env)
 * @returns Modified environment with bundled tool directories in PATH
 */
export function buildAgentEnv(
  toolInfo: ToolInfo[],
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  // Extract directories from bundled tools
  const bundledDirs: string[] = []
  const seenDirs = new Set<string>()

  for (const tool of toolInfo) {
    if (tool.found && tool.source === 'bundled' && tool.path) {
      const dir = dirname(tool.path)
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir)
        bundledDirs.push(dir)
      }
    }
  }

  // If no bundled tools, return base env as-is
  if (bundledDirs.length === 0) {
    return { ...baseEnv }
  }

  // Prepend bundled directories to PATH
  const pathSep = process.platform === 'win32' ? ';' : ':'
  const existingPath = baseEnv.PATH || ''
  const newPath = bundledDirs.length > 0
    ? `${bundledDirs.join(pathSep)}${existingPath ? pathSep + existingPath : ''}`
    : existingPath

  return {
    ...baseEnv,
    PATH: newPath,
  }
}
