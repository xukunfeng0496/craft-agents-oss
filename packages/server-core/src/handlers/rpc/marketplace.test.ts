/**
 * Tests for INSTALL_SKILL path safety.
 *
 * The registry server (skills.gz.cvte.cn) is trusted infra, but its response
 * shape (skillName, file.path) still crosses a filesystem-write boundary
 * un-validated. join() does not stop '..' traversal or absolute-path
 * overwrites, so this guards the defense-in-depth check added in
 * marketplace.ts: any file.path escaping the workspace's skill directory
 * must throw before anything is written to disk.
 */

import { describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let mockWorkspaceRoot = ''
let mockSkillFiles: Array<{ path: string; content: string }> = []

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => ({ id, name: id, rootPath: mockWorkspaceRoot }),
  getCvteIdentity: () => undefined,
}))

mock.module('@craft-agent/shared/marketplace', () => ({
  MarketplaceClient: class {
    async getSkillFiles(_skillName: string) {
      return mockSkillFiles
    }
    async getRegistry() {
      return { skills: [] }
    }
  },
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  getWorkspaceSkillsPath: (rootPath: string) => join(rootPath, 'skills'),
}))

const { registerMarketplaceHandlers } = await import('./marketplace')

function ctx(): RequestContext {
  return { clientId: 'c1', workspaceId: 'ws-1', webContentsId: 1 }
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
  }

  const deps = {
    platform: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
  } as unknown as HandlerDeps

  registerMarketplaceHandlers(server, deps)

  const install = handlers.get(RPC_CHANNELS.marketplace.INSTALL_SKILL)
  if (!install) throw new Error('INSTALL_SKILL handler not registered')
  return install
}

describe('marketplace INSTALL_SKILL path safety', () => {
  it('throws and writes nothing when file.path escapes the skill directory via ../', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'marketplace-install-'))
    mockWorkspaceRoot = workspaceRoot
    mockSkillFiles = [{ path: '../../evil.txt', content: 'pwned' }]

    const install = createHarness()

    await expect(install(ctx(), 'ws-1', 'my-skill')).rejects.toThrow(/invalid path|escaping/i)

    // Nothing should have been written outside (or even inside) the skill dir.
    expect(existsSync(join(workspaceRoot, 'evil.txt'))).toBe(false)
    const skillDir = join(workspaceRoot, 'skills', 'my-skill')
    if (existsSync(skillDir)) {
      expect(readdirSync(skillDir)).toEqual([])
    }

    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('throws when skillName itself attempts to traverse out of the skills directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'marketplace-install-'))
    mockWorkspaceRoot = workspaceRoot
    mockSkillFiles = [{ path: 'SKILL.md', content: '# ok' }]

    const install = createHarness()

    await expect(install(ctx(), 'ws-1', '../../escape')).rejects.toThrow(/invalid path|escaping/i)

    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('installs normally when paths are well-formed', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'marketplace-install-'))
    mockWorkspaceRoot = workspaceRoot
    mockSkillFiles = [
      { path: 'SKILL.md', content: '# hello' },
      { path: 'scripts/run.sh', content: 'echo hi' },
    ]

    const install = createHarness()
    await install(ctx(), 'ws-1', 'good-skill')

    const skillDir = join(workspaceRoot, 'skills', 'good-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir, 'scripts', 'run.sh'))).toBe(true)

    rmSync(workspaceRoot, { recursive: true, force: true })
  })
})
