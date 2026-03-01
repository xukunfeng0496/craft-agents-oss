import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  listSchedulerHooks,
  createSchedulerHook,
  updateSchedulerHook,
  deleteSchedulerHook,
} from './crud.ts'

describe('Hooks CRUD Operations', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'hooks-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test('listSchedulerHooks returns empty array when no hooks.json', async () => {
    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toEqual([])
  })

  test('listSchedulerHooks returns empty array when no SchedulerTick hooks', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )
    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toEqual([])
  })

  test('listSchedulerHooks returns scheduler hooks', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          SchedulerTick: [
            {
              cron: '0 9 * * *',
              timezone: 'America/New_York',
              permissionMode: 'ask',
              labels: ['morning'],
              enabled: true,
              hooks: [{ type: 'prompt', prompt: 'Good morning!' }],
            },
          ],
        },
      })
    )

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toHaveLength(1)
    expect(hooks[0]).toMatchObject({
      id: 'scheduler-0',
      cron: '0 9 * * *',
      timezone: 'America/New_York',
      permissionMode: 'ask',
      labels: ['morning'],
      enabled: true,
      prompt: 'Good morning!',
    })
  })

  test('createSchedulerHook creates new hook', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    const created = await createSchedulerHook(testDir, {
      cron: '0 9 * * 1-5',
      timezone: 'UTC',
      permissionMode: 'allow-all',
      labels: ['work'],
      enabled: true,
      prompt: 'Start work',
    })

    expect(created.id).toBe('scheduler-0')
    expect(created.cron).toBe('0 9 * * 1-5')

    // Verify file was written
    const content = await readFile(join(testDir, 'hooks.json'), 'utf-8')
    const config = JSON.parse(content)
    expect(config.hooks.SchedulerTick).toHaveLength(1)
    expect(config.hooks.SchedulerTick[0].cron).toBe('0 9 * * 1-5')
  })

  test('updateSchedulerHook updates existing hook', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          SchedulerTick: [
            {
              cron: '0 9 * * *',
              hooks: [{ type: 'prompt', prompt: 'Old prompt' }],
            },
          ],
        },
      })
    )

    await updateSchedulerHook(testDir, {
      id: 'scheduler-0',
      cron: '0 10 * * *',
      prompt: 'New prompt',
      labels: ['updated'],
    })

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks[0]).toMatchObject({
      cron: '0 10 * * *',
      prompt: 'New prompt',
      labels: ['updated'],
    })
  })

  test('updateSchedulerHook throws on invalid ID', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    await expect(
      updateSchedulerHook(testDir, {
        id: 'scheduler-999',
        cron: '0 9 * * *',
        prompt: 'Test',
      })
    ).rejects.toThrow()
  })

  test('deleteSchedulerHook deletes hook', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          SchedulerTick: [
            {
              cron: '0 9 * * *',
              hooks: [{ type: 'prompt', prompt: 'Test' }],
            },
          ],
        },
      })
    )

    await deleteSchedulerHook(testDir, 'scheduler-0')

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toHaveLength(0)
  })

  test('deleteSchedulerHook throws on invalid ID', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    await expect(deleteSchedulerHook(testDir, 'scheduler-999')).rejects.toThrow()
  })

  test('creates multiple hooks with incrementing IDs', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    const hook1 = await createSchedulerHook(testDir, {
      cron: '0 9 * * *',
      prompt: 'First hook',
    })
    const hook2 = await createSchedulerHook(testDir, {
      cron: '0 10 * * *',
      prompt: 'Second hook',
    })
    const hook3 = await createSchedulerHook(testDir, {
      cron: '0 11 * * *',
      prompt: 'Third hook',
    })

    expect(hook1.id).toBe('scheduler-0')
    expect(hook2.id).toBe('scheduler-1')
    expect(hook3.id).toBe('scheduler-2')

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toHaveLength(3)
  })

  test('handles hooks with all optional fields', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    const created = await createSchedulerHook(testDir, {
      cron: '0 9 * * 1-5',
      timezone: 'America/New_York',
      permissionMode: 'safe',
      labels: ['work', 'morning'],
      enabled: false,
      prompt: 'Complex hook',
    })

    expect(created).toMatchObject({
      id: 'scheduler-0',
      cron: '0 9 * * 1-5',
      timezone: 'America/New_York',
      permissionMode: 'safe',
      labels: ['work', 'morning'],
      enabled: false,
      prompt: 'Complex hook',
    })

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks[0]).toMatchObject({
      timezone: 'America/New_York',
      permissionMode: 'safe',
      labels: ['work', 'morning'],
      enabled: false,
    })
  })
})
