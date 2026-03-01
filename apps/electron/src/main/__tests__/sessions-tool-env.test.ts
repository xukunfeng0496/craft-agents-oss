/**
 * Tests for buildAgentEnv from sessions.ts
 *
 * Tests the environment variable building logic that prepends bundled tool
 * directories to PATH for agent execution.
 */
import { describe, it, expect } from 'bun:test'
import { buildAgentEnv } from '../agent-env'
import type { ToolInfo } from '../../shared/types'

describe('buildAgentEnv', () => {
  const isWin = process.platform === 'win32'
  const pathSep = isWin ? ';' : ':'

  it('returns base env when no tools are provided', () => {
    const baseEnv = { PATH: '/usr/bin', HOME: '/home/user' }
    const result = buildAgentEnv([], baseEnv)

    expect(result.PATH).toBe('/usr/bin')
    expect(result.HOME).toBe('/home/user')
  })

  it('returns base env when no bundled tools are found', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: 'git', source: 'system' },
      { id: 'python', found: false, source: 'none' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    expect(result.PATH).toBe('/usr/bin')
  })

  it('prepends bundled tool directory to PATH', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: '/app/vendor/git/bin/git.exe', source: 'bundled' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    expect(result.PATH).toBe(`/app/vendor/git/bin${pathSep}/usr/bin`)
  })

  it('prepends multiple bundled tool directories to PATH', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: '/app/vendor/git/bin/git.exe', source: 'bundled' },
      { id: 'python', found: true, path: '/app/vendor/python/python.exe', source: 'bundled' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    const expectedPath = `/app/vendor/git/bin${pathSep}/app/vendor/python${pathSep}/usr/bin`
    expect(result.PATH).toBe(expectedPath)
  })

  it('deduplicates directories when same directory appears multiple times', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: '/app/vendor/bin/git.exe', source: 'bundled' },
      { id: 'python', found: true, path: '/app/vendor/bin/python.exe', source: 'bundled' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    expect(result.PATH).toBe(`/app/vendor/bin${pathSep}/usr/bin`)
  })

  it('handles missing PATH in base env', () => {
    const baseEnv = { HOME: '/home/user' }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: '/app/vendor/git/bin/git.exe', source: 'bundled' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    expect(result.PATH).toBe('/app/vendor/git/bin')
    expect(result.HOME).toBe('/home/user')
  })

  it('preserves all other environment variables', () => {
    const baseEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      USER: 'testuser',
      LANG: 'en_US.UTF-8',
    }
    const toolInfo: ToolInfo[] = [
      { id: 'git', found: true, path: '/app/vendor/git/bin/git.exe', source: 'bundled' },
    ]

    const result = buildAgentEnv(toolInfo, baseEnv)
    expect(result.HOME).toBe('/home/user')
    expect(result.USER).toBe('testuser')
    expect(result.LANG).toBe('en_US.UTF-8')
  })

  it('uses process.env as default base env', () => {
    const toolInfo: ToolInfo[] = []
    const result = buildAgentEnv(toolInfo)

    // Should have PATH from process.env
    expect(result.PATH).toBeDefined()
    expect(typeof result.PATH).toBe('string')
  })
})
