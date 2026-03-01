// apps/electron/src/main/tool-detection.ts
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { getBundledToolPath } from '@work-agent/shared/tools'
import type { ToolInfo } from '../shared/types'

/**
 * Spawns a command and returns true if it exits with code 0.
 * Silently handles errors (command not found, timeout).
 */
function checkCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const settle = (val: boolean) => {
      if (!settled) { settled = true; resolve(val) }
    }

    const proc = spawn(cmd, args, { stdio: 'ignore' })
    proc.on('close', code => settle(code === 0))
    proc.on('error', () => settle(false))

    // Safety timeout so we never block onboarding
    const timer = setTimeout(() => {
      proc.kill()
      settle(false)
    }, 5000)

    proc.on('close', () => clearTimeout(timer))
    proc.on('error', () => clearTimeout(timer))
  })
}

/**
 * Get version string from a tool.
 * Returns undefined if version cannot be determined.
 */
async function getToolVersion(toolPath: string, toolName: 'git' | 'python'): Promise<string | undefined> {
  return new Promise(resolve => {
    const args = toolName === 'git' ? ['--version'] : ['--version']
    const proc = spawn(toolPath, args, { stdio: 'pipe' })

    let output = ''
    proc.stdout?.on('data', (data) => {
      output += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0 && output) {
        // Extract version from output
        // Git: "git version 2.x.x"
        // Python: "Python 3.x.x"
        const match = output.match(/(\d+\.\d+\.\d+)/)
        resolve(match ? match[1] : undefined)
      } else {
        resolve(undefined)
      }
    })

    proc.on('error', () => resolve(undefined))

    // Timeout
    setTimeout(() => {
      proc.kill()
      resolve(undefined)
    }, 3000)
  })
}

/**
 * Detect information about a specific tool.
 * On Windows, checks bundled tools first, then system tools.
 * On other platforms, only checks system tools.
 */
async function detectToolInfo(toolName: 'git' | 'python'): Promise<ToolInfo> {
  const isWin = process.platform === 'win32'

  // Step 1: Check bundled tools (Windows only)
  if (isWin) {
    const bundledPath = getBundledToolPath(toolName)
    if (bundledPath && existsSync(bundledPath)) {
      const works = await checkCommand(bundledPath, ['--version'])
      if (works) {
        const version = await getToolVersion(bundledPath, toolName)
        return {
          id: toolName,
          found: true,
          path: bundledPath,
          source: 'bundled',
          version,
        }
      }
    }
  }

  // Step 2: Check system tools
  const systemCmd = toolName === 'python' && !isWin ? 'python3' : toolName
  const systemWorks = await checkCommand(systemCmd, ['--version'])

  if (systemWorks) {
    const version = await getToolVersion(systemCmd, toolName)
    return {
      id: toolName,
      found: true,
      path: systemCmd,
      source: 'system',
      version,
    }
  }

  // Step 3: Not found
  return {
    id: toolName,
    found: false,
    source: 'none',
  }
}

/**
 * Detect whether required tools are installed.
 * Runs checks in parallel for speed.
 */
export async function detectMissingTools(): Promise<ToolInfo[]> {
  const [gitInfo, pythonInfo] = await Promise.all([
    detectToolInfo('git'),
    detectToolInfo('python'),
  ])

  return [gitInfo, pythonInfo]
}
