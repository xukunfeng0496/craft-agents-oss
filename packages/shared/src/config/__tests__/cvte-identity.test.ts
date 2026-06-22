import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-cvteid-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        llmConnections: [],
      },
      null,
      2,
    ),
    'utf-8',
  )
  return { configDir, configPath: join(configDir, 'config.json') }
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { getCvteIdentity, setCvteIdentity } from '${STORAGE_MODULE_PATH}'; ${code}`,
    ],
    { env: { ...process.env, CRAFT_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' },
  )
  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }
  return run.stdout.toString().trim()
}

describe('cvteIdentity storage', () => {
  it('returns undefined when unset', () => {
    const { configDir } = setupConfigDir()
    expect(runEval(configDir, 'console.log(JSON.stringify(getCvteIdentity() ?? null))')).toBe('null')
  })

  it('persists account+email to config.json', () => {
    const { configDir, configPath } = setupConfigDir()
    runEval(configDir, "setCvteIdentity({ account: 'luoxiaowei', email: 'luoxiaowei@cvte.com' })")
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(cfg.cvteIdentity).toEqual({ account: 'luoxiaowei', email: 'luoxiaowei@cvte.com' })
  })

  it('round-trips and omits email when not provided', () => {
    const { configDir } = setupConfigDir()
    runEval(configDir, "setCvteIdentity({ account: 'luoxiaowei' })")
    expect(runEval(configDir, 'console.log(JSON.stringify(getCvteIdentity()))')).toBe('{"account":"luoxiaowei"}')
  })
})
