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
      id: expect.any(String),
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

    expect(created.id).toEqual(expect.any(String))
    expect(created.id.length).toBeGreaterThan(0)
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
      JSON.stringify({ version: 1, hooks: {} })
    )

    // Create a hook first to get a real ID
    const created = await createSchedulerHook(testDir, {
      cron: '0 9 * * *',
      prompt: 'Old prompt',
    })

    await updateSchedulerHook(testDir, {
      id: created.id,
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

  test('updateSchedulerHook throws when no hooks exist', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    await expect(
      updateSchedulerHook(testDir, {
        id: 'some-nonexistent-uuid',
        cron: '0 9 * * *',
        prompt: 'Test',
      })
    ).rejects.toThrow()
  })

  test('deleteSchedulerHook deletes hook', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    // Create a hook first to get a real ID
    const created = await createSchedulerHook(testDir, {
      cron: '0 9 * * *',
      prompt: 'Test',
    })

    await deleteSchedulerHook(testDir, created.id)

    const hooks = await listSchedulerHooks(testDir)
    expect(hooks).toHaveLength(0)
  })

  test('deleteSchedulerHook throws when no hooks exist', async () => {
    await writeFile(
      join(testDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: {} })
    )

    await expect(deleteSchedulerHook(testDir, 'some-nonexistent-uuid')).rejects.toThrow()
  })

  test('creates multiple hooks with unique IDs', async () => {
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

    // All IDs should be strings
    expect(hook1.id).toEqual(expect.any(String))
    expect(hook2.id).toEqual(expect.any(String))
    expect(hook3.id).toEqual(expect.any(String))

    // All IDs should be unique
    expect(hook1.id).not.toBe(hook2.id)
    expect(hook2.id).not.toBe(hook3.id)
    expect(hook1.id).not.toBe(hook3.id)

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
      id: expect.any(String),
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
