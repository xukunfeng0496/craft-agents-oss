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
      return { hooks: {} }
    }
    throw err
  }
}

/**
 * Write hooks.json to workspace
 */
async function writeHooksConfig(workspaceRoot: string, config: HooksConfig): Promise<void> {
  const hooksPath = join(workspaceRoot, 'hooks.json')
  // Add version field when writing to disk
  const fileContent = { version: 1, ...config }
  const content = JSON.stringify(fileContent, null, 2)
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

