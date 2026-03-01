/**
 * CRUD operations for hooks.json SchedulerTick entries
 *
 * Uses persistent UUID-based IDs stored in matcher.id.
 * Supports multiple time points per logical task by grouping matchers
 * that share the same base UUID (e.g., "uuid" and "uuid:1", "uuid:2").
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HookMatcher } from './types.ts'

export interface ScheduleTime {
  hour: number
  minute: number
}

export interface SchedulerHookData {
  id: string
  name?: string
  cron: string
  times?: ScheduleTime[]
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  prompt: string
  workingDirectory?: string
}

/**
 * Read hooks.json from workspace (raw JSON, not transformed)
 */
async function readRawHooksJson(workspaceRoot: string): Promise<Record<string, unknown>> {
  const hooksPath = join(workspaceRoot, 'hooks.json')
  try {
    const content = await readFile(hooksPath, 'utf-8')
    return JSON.parse(content)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { version: 1, hooks: {} }
    }
    throw err
  }
}

/**
 * Read the SchedulerTick matchers from hooks.json (raw, no schema transform)
 * Returns the matchers array and the full raw JSON for write-back.
 */
async function readSchedulerTickMatchers(workspaceRoot: string): Promise<{
  matchers: HookMatcher[]
  raw: Record<string, unknown>
}> {
  const raw = await readRawHooksJson(workspaceRoot)
  const hooks = (raw as any).hooks as Record<string, any[]> | undefined
  const matchers = (hooks?.SchedulerTick || []) as HookMatcher[]
  return { matchers, raw }
}

/**
 * Write hooks.json, only updating the SchedulerTick array while preserving everything else
 */
async function writeSchedulerTickMatchers(
  workspaceRoot: string,
  raw: Record<string, unknown>,
  matchers: HookMatcher[]
): Promise<void> {
  const hooksPath = join(workspaceRoot, 'hooks.json')
  const updated = { ...raw }
  if (!updated.version) updated.version = 1
  if (!updated.hooks || typeof updated.hooks !== 'object') {
    updated.hooks = {}
  }
  ;(updated.hooks as Record<string, unknown>).SchedulerTick = matchers
  await writeFile(hooksPath, JSON.stringify(updated, null, 2), 'utf-8')
}

/**
 * Extract the base UUID from a matcher ID (strips ":N" suffix)
 */
function getBaseId(id: string): string {
  const colonIdx = id.lastIndexOf(':')
  if (colonIdx === -1) return id
  const suffix = id.slice(colonIdx + 1)
  // Only strip if suffix is numeric (time index)
  if (/^\d+$/.test(suffix)) return id.slice(0, colonIdx)
  return id
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
    name: matcher.name,
    cron: matcher.cron,
    timezone: matcher.timezone,
    permissionMode: matcher.permissionMode,
    labels: matcher.labels,
    enabled: matcher.enabled,
    prompt: promptHook.prompt,
    workingDirectory: matcher.workingDirectory,
  }
}

/**
 * Convert SchedulerHookData to HookMatcher(s)
 * If times array has multiple entries, generates multiple matchers with suffixed IDs
 */
function dataToMatchers(data: SchedulerHookData): HookMatcher[] {
  const times = data.times
  if (!times || times.length <= 1) {
    // Single cron, single matcher
    return [{
      id: data.id,
      name: data.name,
      cron: data.cron,
      timezone: data.timezone,
      permissionMode: data.permissionMode,
      labels: data.labels,
      enabled: data.enabled,
      workingDirectory: data.workingDirectory,
      hooks: [{ type: 'prompt', prompt: data.prompt }],
    }]
  }

  // Multiple times: generate one matcher per time point
  // Import scheduleToCron logic inline to avoid circular deps
  return times.map((t, i) => {
    // Parse day-of-week from original cron if available
    const cronParts = data.cron.trim().split(/\s+/)
    const dowField = cronParts.length === 5 ? cronParts[4] : '*'
    const cron = `${t.minute} ${t.hour} * * ${dowField}`
    return {
      id: i === 0 ? data.id : `${data.id}:${i}`,
      name: data.name,
      cron,
      timezone: data.timezone,
      permissionMode: data.permissionMode,
      labels: data.labels,
      enabled: data.enabled,
      workingDirectory: data.workingDirectory,
      hooks: [{ type: 'prompt' as const, prompt: data.prompt }],
    }
  })
}

/**
 * Ensure all SchedulerTick matchers have persistent IDs.
 * If any matcher lacks an id, assign a UUID and write back to hooks.json.
 */
async function ensureMatcherIds(workspaceRoot: string): Promise<void> {
  const raw = await readRawHooksJson(workspaceRoot)
  const hooks = (raw as any).hooks as Record<string, any[]> | undefined
  if (!hooks?.SchedulerTick) return

  let modified = false
  for (const matcher of hooks.SchedulerTick) {
    if (!matcher.id) {
      matcher.id = randomUUID()
      modified = true
    }
  }

  if (modified) {
    const hooksPath = join(workspaceRoot, 'hooks.json')
    await writeFile(hooksPath, JSON.stringify(raw, null, 2), 'utf-8')
  }
}

/**
 * Group matchers by base ID to support multi-time tasks
 */
function groupMatchersByBaseId(matchers: HookMatcher[]): Map<string, HookMatcher[]> {
  const groups = new Map<string, HookMatcher[]>()
  for (const matcher of matchers) {
    if (!matcher.id) continue
    const baseId = getBaseId(matcher.id)
    const group = groups.get(baseId) || []
    group.push(matcher)
    groups.set(baseId, group)
  }
  return groups
}

/**
 * Parse cron to extract time
 */
function cronToTime(cron: string): ScheduleTime | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = parseInt(parts[0]!, 10)
  const hour = parseInt(parts[1]!, 10)
  if (isNaN(minute) || isNaN(hour)) return null
  return { hour, minute }
}

/**
 * List all SchedulerTick hooks, grouped by base ID
 */
export async function listSchedulerHooks(workspaceRoot: string): Promise<SchedulerHookData[]> {
  // Ensure all matchers have IDs (backward-compatible migration)
  await ensureMatcherIds(workspaceRoot)

  const { matchers: schedulerMatchers } = await readSchedulerTickMatchers(workspaceRoot)

  const groups = groupMatchersByBaseId(schedulerMatchers)
  const results: SchedulerHookData[] = []

  for (const [baseId, matchers] of groups) {
    const primary = matchers[0]!
    const data = matcherToData(primary, baseId)
    if (!data) continue

    // Collect times from all matchers in the group
    if (matchers.length > 1) {
      const times: ScheduleTime[] = []
      for (const m of matchers) {
        if (m.cron) {
          const t = cronToTime(m.cron)
          if (t) times.push(t)
        }
      }
      data.times = times
    } else {
      const t = cronToTime(data.cron)
      if (t) data.times = [t]
    }

    results.push(data)
  }

  return results
}

/**
 * Create a new SchedulerTick hook
 */
export async function createSchedulerHook(
  workspaceRoot: string,
  data: Omit<SchedulerHookData, 'id'>
): Promise<SchedulerHookData> {
  const { matchers, raw } = await readSchedulerTickMatchers(workspaceRoot)

  const id = randomUUID()
  const fullData = { ...data, id }
  const newMatchers = dataToMatchers(fullData)
  matchers.push(...newMatchers)

  await writeSchedulerTickMatchers(workspaceRoot, raw, matchers)
  return fullData
}

/**
 * Update an existing SchedulerTick hook by UUID
 */
export async function updateSchedulerHook(
  workspaceRoot: string,
  data: SchedulerHookData
): Promise<void> {
  const { matchers, raw } = await readSchedulerTickMatchers(workspaceRoot)

  if (matchers.length === 0) {
    throw new Error('No SchedulerTick hooks found')
  }

  const baseId = getBaseId(data.id)

  // Remove all matchers with this base ID
  const filtered = matchers.filter(
    m => !m.id || getBaseId(m.id) !== baseId
  )

  // Add new matchers
  const newMatchers = dataToMatchers({ ...data, id: baseId })
  filtered.push(...newMatchers)

  await writeSchedulerTickMatchers(workspaceRoot, raw, filtered)
}

/**
 * Delete a SchedulerTick hook by UUID
 */
export async function deleteSchedulerHook(
  workspaceRoot: string,
  id: string
): Promise<void> {
  const { matchers, raw } = await readSchedulerTickMatchers(workspaceRoot)

  if (matchers.length === 0) {
    throw new Error('No SchedulerTick hooks found')
  }

  const baseId = getBaseId(id)

  // Remove all matchers with this base ID
  const filtered = matchers.filter(
    m => !m.id || getBaseId(m.id) !== baseId
  )

  if (filtered.length === matchers.length) {
    throw new Error(`Hook not found: ${id}`)
  }

  await writeSchedulerTickMatchers(workspaceRoot, raw, filtered)
}
