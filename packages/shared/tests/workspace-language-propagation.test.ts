import { describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { createWorkspaceAtPath } from '../src/workspaces/storage'

describe('addWorkspace language propagation', () => {
  it('seeds status and labels with app language when no explicit language is provided', () => {
    const testRoot = join(process.cwd(), '.tmp-test-workspace-language-propagation')
    const workspaceRoot = join(testRoot, 'workspaces', 'seed-by-app-language')

    rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(workspaceRoot, { recursive: true })

    // Simulate addWorkspace propagating language from config to createWorkspaceAtPath
    createWorkspaceAtPath(workspaceRoot, 'Seeded Workspace', undefined, 'zh-CN')

    const statusConfig = JSON.parse(readFileSync(join(workspaceRoot, 'statuses/config.json'), 'utf-8'))
    const labelConfig = JSON.parse(readFileSync(join(workspaceRoot, 'labels/config.json'), 'utf-8'))

    expect(statusConfig.statuses.find((s: any) => s.id === 'todo')?.label).toBe('待处理')
    expect(labelConfig.labels.find((l: any) => l.id === 'development')?.name).toBe('开发')

    rmSync(testRoot, { recursive: true, force: true })
  })
})
