// apps/electron/src/main/tool-detection.ts
import { spawn } from 'child_process'
import type { MissingTool } from '../shared/types'

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
 * Detect whether required tools are installed.
 * Runs checks in parallel for speed.
 */
export async function detectMissingTools(): Promise<MissingTool[]> {
  const isWin = process.platform === 'win32'

  const [gitFound, pythonFound] = await Promise.all([
    checkCommand('git', ['--version']),
    checkCommand(isWin ? 'python' : 'python3', ['--version']),
  ])

  return [
    { id: 'git', found: gitFound },
    { id: 'python', found: pythonFound },
  ]
}
