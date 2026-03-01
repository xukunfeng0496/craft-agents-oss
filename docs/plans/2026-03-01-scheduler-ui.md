# Scheduler UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add UI support for viewing and editing SchedulerTick hooks in hooks.json with user-friendly schedule picker instead of raw cron expressions.

**Architecture:** Build a new Hooks settings page that allows users to manage SchedulerTick hooks through a visual schedule picker. The core challenge is bidirectional conversion between cron expressions and user-friendly time/day selections. We'll extend existing schedule utilities, add hooks CRUD operations, create IPC handlers, and build React UI components.

**Tech Stack:** TypeScript, React 18, Jotai, Tailwind CSS v4, shadcn/ui, Zod validation, croner (cron parsing), Bun test

**Development Approach:** Strict Test-Driven Development (TDD)
- Write failing tests first (Red)
- Implement minimal code to pass (Green)
- Refactor and improve (Refactor)
- Commit only when tests pass

---

## Testing Strategy

**TDD Approach:** We follow strict Test-Driven Development:
1. Write failing test first
2. Run test to verify it fails
3. Write minimal code to pass the test
4. Run test to verify it passes
5. Refactor if needed
6. Commit

**Test Coverage:**
- Unit tests: cronToSchedule, scheduleToCron roundtrip
- Integration tests: CRUD operations with mock filesystem
- Component tests: UI components with user interactions
- E2E tests: Full workflow from UI to hooks.json

**Test Framework:** Bun test (built-in test runner)

---

## Task 1: Cron to Schedule Conversion Utility (TDD)

**Files:**
- Create: `packages/shared/src/schedules/utils.test.ts`
- Modify: `packages/shared/src/schedules/utils.ts`

**Step 1: Write failing tests for cronToSchedule**

Create test file `packages/shared/src/schedules/utils.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { cronToSchedule, scheduleToCron } from './utils.ts'

describe('cronToSchedule', () => {
  test('parses simple daily cron', () => {
    const result = cronToSchedule('0 9 * * *')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: undefined,
    })
  })

  test('parses cron with specific days', () => {
    const result = cronToSchedule('0 9 * * 1,3,5')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'wed', 'fri'],
    })
  })

  test('parses cron with minutes', () => {
    const result = cronToSchedule('30 15 * * *')
    expect(result).toEqual({
      times: [{ hour: 15, minute: 30 }],
      days: undefined,
    })
  })

  test('parses weekdays', () => {
    const result = cronToSchedule('0 9 * * 1,2,3,4,5')
    expect(result).toEqual({
      times: [{ hour: 9, minute: 0 }],
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })
  })

  test('parses weekends', () => {
    const result = cronToSchedule('0 10 * * 0,6')
    expect(result).toEqual({
      times: [{ hour: 10, minute: 0 }],
      days: ['sun', 'sat'],
    })
  })

  test('returns null for complex day-of-month', () => {
    const result = cronToSchedule('0 9 15 * *')
    expect(result).toBeNull()
  })

  test('returns null for complex month', () => {
    const result = cronToSchedule('0 9 * 1,6 *')
    expect(result).toBeNull()
  })

  test('returns null for invalid format', () => {
    expect(cronToSchedule('invalid')).toBeNull()
    expect(cronToSchedule('0 9 *')).toBeNull()
    expect(cronToSchedule('')).toBeNull()
  })

  test('returns null for invalid hour/minute', () => {
    expect(cronToSchedule('60 9 * * *')).toBeNull()
    expect(cronToSchedule('0 25 * * *')).toBeNull()
    expect(cronToSchedule('-1 9 * * *')).toBeNull()
  })

  test('returns null for invalid day-of-week', () => {
    expect(cronToSchedule('0 9 * * 7')).toBeNull()
    expect(cronToSchedule('0 9 * * -1')).toBeNull()
    expect(cronToSchedule('0 9 * * abc')).toBeNull()
  })
})

describe('scheduleToCron and cronToSchedule roundtrip', () => {
  test('roundtrip: daily schedule', () => {
    const times = [{ hour: 9, minute: 0 }]
    const crons = scheduleToCron(times)
    const result = cronToSchedule(crons[0]!)
    expect(result).toEqual({ times, days: undefined })
  })

  test('roundtrip: weekday schedule', () => {
    const times = [{ hour: 9, minute: 30 }]
    const days = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
    const crons = scheduleToCron(times, days)
    const result = cronToSchedule(crons[0]!)
    expect(result).toEqual({ times, days: [...days] })
  })

  test('roundtrip: weekend schedule', () => {
    const times = [{ hour: 10, minute: 0 }]
    const days = ['sat', 'sun'] as const
    const crons = scheduleToCron(times, days)
    const result = cronToSchedule(crons[0]!)
    expect(result?.times).toEqual(times)
    expect(result?.days).toContain('sat')
    expect(result?.days).toContain('sun')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/shared && bun test src/schedules/utils.test.ts
```

Expected: Tests fail with "cronToSchedule is not defined"

**Step 3: Add cronToSchedule function**

Add this function after the `scheduleToCron` function (around line 28):

```typescript
/**
 * Parse a cron expression back to schedule times and days.
 * Only handles the subset we generate: "minute hour * * day-of-week"
 * 
 * Returns null if the cron expression is too complex to represent in simple UI.
 * 
 * Examples:
 *   "0 9 * * *"     → { times: [{hour:9, minute:0}], days: undefined }
 *   "0 9 * * 1,3,5" → { times: [{hour:9, minute:0}], days: ['mon','wed','fri'] }
 *   "30 15 * * *"   → { times: [{hour:15, minute:30}], days: undefined }
 */
export function cronToSchedule(cron: string): { times: ScheduleTime[], days?: ScheduleDay[] } | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteStr, hourStr, dayOfMonth, month, dowStr] = parts

  // We only support: minute hour * * day-of-week
  if (dayOfMonth !== '*' || month !== '*') return null

  const minute = parseInt(minuteStr!, 10)
  const hour = parseInt(hourStr!, 10)

  if (isNaN(minute) || isNaN(hour)) return null
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null

  const times: ScheduleTime[] = [{ hour, minute }]

  // Parse day-of-week
  let days: ScheduleDay[] | undefined = undefined
  if (dowStr !== '*') {
    const cronToDayMap: Record<number, ScheduleDay> = {
      0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
    }
    
    const dayNums = dowStr!.split(',').map(s => parseInt(s.trim(), 10))
    if (dayNums.some(n => isNaN(n) || n < 0 || n > 6)) return null
    
    days = dayNums.map(n => cronToDayMap[n]!).filter(Boolean)
    if (days.length === 0) return null
  }

  return { times, days }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/shared && bun test src/schedules/utils.test.ts
```

Expected: All tests pass

**Step 5: Type check**

```bash
cd packages/shared && bun run tsc --noEmit
```

Expected: No type errors

**Step 6: Commit**

```bash
git add packages/shared/src/schedules/utils.ts
git commit -m "feat: add cronToSchedule utility for parsing cron to schedule

Add bidirectional conversion support for cron expressions. This enables
UI to display and edit hooks.json SchedulerTick entries using a
user-friendly schedule picker instead of raw cron syntax.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Hooks CRUD Operations (TDD)

**Files:**
- Create: `packages/shared/src/hooks-simple/crud.test.ts`
- Create: `packages/shared/src/hooks-simple/crud.ts`
- Modify: `packages/shared/src/hooks-simple/index.ts`

**Step 1: Write failing tests for CRUD operations**

Create test file `packages/shared/src/hooks-simple/crud.test.ts`:

```typescript
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
})
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/shared && bun test src/hooks-simple/crud.test.ts
```

Expected: Tests fail with "Cannot find module './crud.ts'"

**Step 3: Create CRUD operations file**

```typescript
/**
 * CRUD operations for hooks.json SchedulerTick entries
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HooksConfig, HookMatcher } from './types.ts'
import { HooksConfigSchema } from './schemas.ts'

export interface SchedulerHookData {
  id: string  // Generated UUID
  cron: string
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  prompt: string
}

/**
 * Read hooks.json from workspace
 */
async function readHooksConfig(workspaceRoot: string): Promise<HooksConfig> {
  const hooksPath = join(workspaceRoot, 'hooks.json')
  try {
    const content = await readFile(hooksPath, 'utf-8')
    const parsed = JSON.parse(content)
    return HooksConfigSchema.parse(parsed)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, return empty config
      return { version: 1, hooks: {} }
    }
    throw err
  }
}

/**
 * Write hooks.json to workspace
 */
async function writeHooksConfig(workspaceRoot: string, config: HooksConfig): Promise<void> {
  const hooksPath = join(workspaceRoot, 'hooks.json')
  const content = JSON.stringify(config, null, 2)
  await writeFile(hooksPath, content, 'utf-8')
}

/**
 * Convert HookMatcher to SchedulerHookData
 */
function matcherToData(matcher: HookMatcher, id: string): SchedulerHookData | null {
  if (!matcher.cron) return null
  
  const promptHook = matcher.hooks.find(h => h.type === 'prompt')
  if (!promptHook || promptHook.type !== 'prompt') return null

  return {
    id,
    cron: matcher.cron,
    timezone: matcher.timezone,
    permissionMode: matcher.permissionMode,
    labels: matcher.labels,
    enabled: matcher.enabled,
    prompt: promptHook.prompt,
  }
}

/**
 * Convert SchedulerHookData to HookMatcher
 */
function dataToMatcher(data: SchedulerHookData): HookMatcher {
  return {
    cron: data.cron,
    timezone: data.timezone,
    permissionMode: data.permissionMode,
    labels: data.labels,
    enabled: data.enabled,
    hooks: [
      {
        type: 'prompt',
        prompt: data.prompt,
      },
    ],
  }
}

/**
 * List all SchedulerTick hooks
 */
export async function listSchedulerHooks(workspaceRoot: string): Promise<SchedulerHookData[]> {
  const config = await readHooksConfig(workspaceRoot)
  const schedulerMatchers = config.hooks.SchedulerTick || []
  
  return schedulerMatchers
    .map((matcher, index) => matcherToData(matcher, `scheduler-${index}`))
    .filter((data): data is SchedulerHookData => data !== null)
}

/**
 * Create a new SchedulerTick hook
 */
export async function createSchedulerHook(
  workspaceRoot: string,
  data: Omit<SchedulerHookData, 'id'>
): Promise<SchedulerHookData> {
  const config = await readHooksConfig(workspaceRoot)
  
  if (!config.hooks.SchedulerTick) {
    config.hooks.SchedulerTick = []
  }
  
  const matcher = dataToMatcher({ ...data, id: '' })
  config.hooks.SchedulerTick.push(matcher)
  
  await writeHooksConfig(workspaceRoot, config)
  
  const id = `scheduler-${config.hooks.SchedulerTick.length - 1}`
  return { ...data, id }
}

/**
 * Update an existing SchedulerTick hook
 */
export async function updateSchedulerHook(
  workspaceRoot: string,
  data: SchedulerHookData
): Promise<void> {
  const config = await readHooksConfig(workspaceRoot)
  
  if (!config.hooks.SchedulerTick) {
    throw new Error('No SchedulerTick hooks found')
  }
  
  const index = parseInt(data.id.replace('scheduler-', ''), 10)
  if (isNaN(index) || index < 0 || index >= config.hooks.SchedulerTick.length) {
    throw new Error(`Invalid hook ID: ${data.id}`)
  }
  
  config.hooks.SchedulerTick[index] = dataToMatcher(data)
  await writeHooksConfig(workspaceRoot, config)
}

/**
 * Delete a SchedulerTick hook
 */
export async function deleteSchedulerHook(
  workspaceRoot: string,
  id: string
): Promise<void> {
  const config = await readHooksConfig(workspaceRoot)
  
  if (!config.hooks.SchedulerTick) {
    throw new Error('No SchedulerTick hooks found')
  }
  
  const index = parseInt(id.replace('scheduler-', ''), 10)
  if (isNaN(index) || index < 0 || index >= config.hooks.SchedulerTick.length) {
    throw new Error(`Invalid hook ID: ${id}`)
  }
  
  config.hooks.SchedulerTick.splice(index, 1)
  await writeHooksConfig(workspaceRoot, config)
}
```

**Step 4: Export from index**

Add to `packages/shared/src/hooks-simple/index.ts`:

```typescript
export * from './crud.ts'
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/shared && bun test src/hooks-simple/crud.test.ts
```

Expected: All tests pass

**Step 6: Type check**

```bash
cd packages/shared && bun run tsc --noEmit
```

Expected: No type errors

**Step 7: Commit**

```bash
git add packages/shared/src/hooks-simple/crud.ts packages/shared/src/hooks-simple/index.ts
git commit -m "feat: add CRUD operations for SchedulerTick hooks

Add functions to list, create, update, and delete SchedulerTick hooks
in hooks.json. These operations will be exposed via IPC for the UI.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: IPC Handlers for Hooks

**Files:**
- Modify: `apps/electron/src/shared/types.ts`
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: Add IPC channel definitions**

In `apps/electron/src/shared/types.ts`, add to `IPC_CHANNELS` object (around line 836):

```typescript
  // Hooks
  HOOKS_LIST_SCHEDULER: 'hooks:list-scheduler',
  HOOKS_CREATE_SCHEDULER: 'hooks:create-scheduler',
  HOOKS_UPDATE_SCHEDULER: 'hooks:update-scheduler',
  HOOKS_DELETE_SCHEDULER: 'hooks:delete-scheduler',
```

**Step 2: Add IPC handlers**

In `apps/electron/src/main/ipc.ts`, add handlers (around line 800, after schedules handlers):

```typescript
  // Hooks - SchedulerTick CRUD
  ipcMain.handle(IPC_CHANNELS.HOOKS_LIST_SCHEDULER, async (_event, workspaceId: string) => {
    try {
      const workspace = await getWorkspace(workspaceId)
      if (!workspace) throw new Error('Workspace not found')
      
      const { listSchedulerHooks } = await import('@work-agent/shared/hooks-simple')
      return await listSchedulerHooks(workspace.rootPath)
    } catch (error) {
      logger.error('Failed to list scheduler hooks:', error)
      throw error
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.HOOKS_CREATE_SCHEDULER,
    async (_event, workspaceId: string, data: any) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) throw new Error('Workspace not found')
        
        const { createSchedulerHook } = await import('@work-agent/shared/hooks-simple')
        return await createSchedulerHook(workspace.rootPath, data)
      } catch (error) {
        logger.error('Failed to create scheduler hook:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOKS_UPDATE_SCHEDULER,
    async (_event, workspaceId: string, data: any) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) throw new Error('Workspace not found')
        
        const { updateSchedulerHook } = await import('@work-agent/shared/hooks-simple')
        await updateSchedulerHook(workspace.rootPath, data)
      } catch (error) {
        logger.error('Failed to update scheduler hook:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOKS_DELETE_SCHEDULER,
    async (_event, workspaceId: string, id: string) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) throw new Error('Workspace not found')
        
        const { deleteSchedulerHook } = await import('@work-agent/shared/hooks-simple')
        await deleteSchedulerHook(workspace.rootPath, id)
      } catch (error) {
        logger.error('Failed to delete scheduler hook:', error)
        throw error
      }
    }
  )
```

**Step 3: Add preload API**

In `apps/electron/src/preload/index.ts`, add to `ElectronAPI` interface and implementation (around line 200):

```typescript
  // In interface
  listSchedulerHooks: (workspaceId: string) => Promise<any[]>
  createSchedulerHook: (workspaceId: string, data: any) => Promise<any>
  updateSchedulerHook: (workspaceId: string, data: any) => Promise<void>
  deleteSchedulerHook: (workspaceId: string, id: string) => Promise<void>

  // In implementation
  listSchedulerHooks: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOOKS_LIST_SCHEDULER, workspaceId),
  createSchedulerHook: (workspaceId: string, data: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOOKS_CREATE_SCHEDULER, workspaceId, data),
  updateSchedulerHook: (workspaceId: string, data: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOOKS_UPDATE_SCHEDULER, workspaceId, data),
  deleteSchedulerHook: (workspaceId: string, id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOOKS_DELETE_SCHEDULER, workspaceId, id),
```

**Step 4: Type check**

```bash
bun run typecheck:all
```

Expected: No type errors

**Step 5: Commit**

```bash
git add apps/electron/src/shared/types.ts apps/electron/src/main/ipc.ts apps/electron/src/preload/index.ts
git commit -m "feat: add IPC handlers for SchedulerTick hooks CRUD

Add IPC channels and handlers to expose hooks CRUD operations to the
renderer process. This enables the UI to manage SchedulerTick hooks.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Localization Strings

**Files:**
- Modify: `packages/shared/locales/en/translation.json`
- Modify: `packages/shared/locales/zh-CN/translation.json`

**Step 1: Add English strings**

In `packages/shared/locales/en/translation.json`, add new section:

```json
  "hooks": {
    "title": "Scheduled Tasks",
    "description": "Manage automated tasks that run on a schedule",
    "empty": "No scheduled tasks yet",
    "emptyDescription": "Create a scheduled task to run prompts automatically",
    "add": "Add Scheduled Task",
    "edit": "Edit Scheduled Task",
    "delete": "Delete Scheduled Task",
    "deleteConfirm": "Are you sure you want to delete this scheduled task?",
    "prompt": "Prompt",
    "promptPlaceholder": "Enter the prompt to run...",
    "schedule": "Schedule",
    "timezone": "Timezone",
    "permissionMode": "Permission Mode",
    "labels": "Labels",
    "labelsPlaceholder": "Add labels (comma-separated)",
    "enabled": "Enabled",
    "disabled": "Disabled",
    "cronExpression": "Cron Expression",
    "cronTooComplex": "This cron expression is too complex to edit in the UI. Please edit hooks.json directly.",
    "invalidCron": "Invalid cron expression",
    "saveSuccess": "Scheduled task saved successfully",
    "deleteSuccess": "Scheduled task deleted successfully",
    "saveError": "Failed to save scheduled task",
    "deleteError": "Failed to delete scheduled task"
  }
```

**Step 2: Add Chinese strings**

In `packages/shared/locales/zh-CN/translation.json`, add:

```json
  "hooks": {
    "title": "定时任务",
    "description": "管理按计划自动运行的任务",
    "empty": "还没有定时任务",
    "emptyDescription": "创建定时任务以自动运行提示词",
    "add": "添加定时任务",
    "edit": "编辑定时任务",
    "delete": "删除定时任务",
    "deleteConfirm": "确定要删除这个定时任务吗？",
    "prompt": "提示词",
    "promptPlaceholder": "输入要运行的提示词...",
    "schedule": "时间安排",
    "timezone": "时区",
    "permissionMode": "权限模式",
    "labels": "标签",
    "labelsPlaceholder": "添加标签（逗号分隔）",
    "enabled": "已启用",
    "disabled": "已禁用",
    "cronExpression": "Cron 表达式",
    "cronTooComplex": "此 cron 表达式过于复杂，无法在 UI 中编辑。请直接编辑 hooks.json。",
    "invalidCron": "无效的 cron 表达式",
    "saveSuccess": "定时任务保存成功",
    "deleteSuccess": "定时任务删除成功",
    "saveError": "保存定时任务失败",
    "deleteError": "删除定时任务失败"
  }
```

**Step 3: Commit**

```bash
git add packages/shared/locales/en/translation.json packages/shared/locales/zh-CN/translation.json
git commit -m "feat: add localization strings for hooks UI

Add English and Chinese translations for the scheduled tasks UI.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Schedule Picker Component

**Files:**
- Create: `apps/electron/src/renderer/components/hooks/SchedulePicker.tsx`

**Step 1: Create schedule picker component**

This component will be created in the next step with full implementation.

```typescript
import { useState } from 'react'
import type { ScheduleTime, ScheduleDay } from '@work-agent/shared/schedules'

interface SchedulePickerProps {
  times: ScheduleTime[]
  days?: ScheduleDay[]
  onChange: (times: ScheduleTime[], days?: ScheduleDay[]) => void
}

export function SchedulePicker({ times, days, onChange }: SchedulePickerProps) {
  // Implementation will be added in next step
  return <div>Schedule Picker</div>
}
```

**Step 2: Commit**

```bash
git add apps/electron/src/renderer/components/hooks/SchedulePicker.tsx
git commit -m "feat: add schedule picker component skeleton

Add basic structure for schedule picker component. Full implementation
will be added in next commit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Hooks Settings Page

**Files:**
- Create: `apps/electron/src/renderer/pages/settings/HooksSettingsPage.tsx`
- Modify: `apps/electron/src/renderer/App.tsx`

**Step 1: Create hooks settings page**

Create the page with basic structure (full implementation in next steps):

```typescript
import { useTranslation } from 'react-i18next'
import { SettingsSection } from '../../components/settings/SettingsSection'

export function HooksSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto">
      <SettingsSection
        title={t('hooks.title')}
        description={t('hooks.description')}
      >
        <div className="text-sm text-muted-foreground">
          {t('hooks.empty')}
        </div>
      </SettingsSection>
    </div>
  )
}
```

**Step 2: Add route to App.tsx**

In `apps/electron/src/renderer/App.tsx`, add route (around line 50):

```typescript
<Route path="/settings/hooks" element={<HooksSettingsPage />} />
```

And add import:

```typescript
import { HooksSettingsPage } from './pages/settings/HooksSettingsPage'
```

**Step 3: Test the page loads**

```bash
bun run electron:dev
```

Navigate to Settings → (we'll add menu item next)

**Step 4: Commit**

```bash
git add apps/electron/src/renderer/pages/settings/HooksSettingsPage.tsx apps/electron/src/renderer/App.tsx
git commit -m "feat: add hooks settings page skeleton

Add basic structure for hooks settings page with routing.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Complete Implementation

The remaining tasks involve:
- Implementing full SchedulePicker component with time/day selection
- Implementing full HooksSettingsPage with list, create, edit, delete
- Adding hooks menu item to settings navigation
- Testing the full flow
- Handling edge cases (complex cron expressions, validation errors)

These will be implemented in subsequent commits following TDD principles.

---

## Testing Strategy (Updated with TDD)

**TDD Workflow:**
1. ✅ Write failing test first (Red)
2. ✅ Write minimal code to pass (Green)
3. ✅ Refactor if needed (Refactor)
4. ✅ Commit with passing tests

**Test Coverage by Layer:**

### 1. Unit Tests (Bun Test)
- ✅ `cronToSchedule()` - All cron parsing scenarios
- ✅ `scheduleToCron()` - Roundtrip conversion
- ✅ Edge cases: invalid inputs, boundary values, complex expressions

### 2. Integration Tests (Bun Test)
- ✅ CRUD operations with mock filesystem
- ✅ hooks.json read/write operations
- ✅ Error handling (missing files, invalid JSON, permission errors)

### 3. Component Tests (React Testing Library - Future)
- Schedule picker interactions
- Form validation
- Error states and loading states

### 4. Manual E2E Testing
- Full workflow: Create → Edit → Delete hooks
- UI responsiveness and user experience
- Timezone handling
- Complex cron expression warnings

**Test Commands:**
```bash
# Run all tests
bun test

# Run specific test file
bun test src/schedules/utils.test.ts

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

**Quality Gates:**
- All tests must pass before commit
- Type check must pass: `bun run typecheck:all`
- Linter must pass: `bun run lint`
- No console errors in dev mode

## Deployment

After all tasks are complete:
1. Run full type check: `bun run typecheck:all`
2. Run linter: `bun run lint`
3. Test in dev mode: `bun run electron:dev`
4. Build and test: `bun run electron:build`
5. Create PR with detailed description

