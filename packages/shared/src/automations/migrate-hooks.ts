/**
 * CVTE one-shot migration: legacy {workspaceRoot}/hooks.json (pre-v0.5.1
 * hooks-simple format) → automations.json v2.
 *
 * Upstream dropped hooks.json reading in v0.5.1 with no migration, which
 * silently kills every legacy user's scheduled prompts on upgrade. This
 * converter runs when AutomationSystem loads and finds no automations.json
 * but a legacy hooks.json:
 *
 *   HookMatcher  → AutomationMatcher (matcher/cron/timezone/permissionMode/
 *                  labels/enabled carry over; UUID id → fresh 6-char hex;
 *                  workingDirectory and _scheduleId/_scheduleName dropped)
 *   prompt hook  → PromptAction (compatible)
 *   command hook → DROPPED (no v2 equivalent; noted in the report — users
 *                  can recreate them as webhook actions)
 *
 * The legacy file is renamed to hooks.json.migrated as a backup; dropped
 * items are recorded in hooks-migration-report.txt next to it.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutomationAction, AutomationMatcher, AutomationsConfig } from './types.ts';
import { APP_EVENTS, AGENT_EVENTS } from './types.ts';
import { AutomationsConfigSchema } from './schemas.ts';
import { generateShortId } from './resolve-config-path.ts';

const LEGACY_HOOKS_FILE = 'hooks.json';

interface LegacyHookDefinition {
  type?: string;
  prompt?: string;
  command?: string;
}

interface LegacyHookMatcher {
  id?: string;
  name?: string;
  matcher?: string;
  cron?: string;
  timezone?: string;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  labels?: string[];
  enabled?: boolean;
  workingDirectory?: string;
  hooks?: LegacyHookDefinition[];
  _scheduleId?: string;
  _scheduleName?: string;
}

export interface HooksMigrationResult {
  migrated: boolean;
  automationCount: number;
  droppedCommandHooks: number;
  notes: string[];
}

const KNOWN_EVENTS = new Set<string>([...APP_EVENTS, ...AGENT_EVENTS]);

/**
 * Convert a legacy hooks.json into automations.json if (and only if) the
 * workspace has no automations.json yet. Idempotent by construction: the
 * legacy file is renamed away on success, so the conversion can never
 * clobber a config the user has since edited.
 */
export function migrateLegacyHooksConfig(workspaceRoot: string, automationsPath: string): HooksMigrationResult {
  const result: HooksMigrationResult = { migrated: false, automationCount: 0, droppedCommandHooks: 0, notes: [] };
  const legacyPath = join(workspaceRoot, LEGACY_HOOKS_FILE);
  if (existsSync(automationsPath) || !existsSync(legacyPath)) return result;

  let legacy: { hooks?: Record<string, LegacyHookMatcher[]> };
  try {
    legacy = JSON.parse(readFileSync(legacyPath, 'utf-8'));
  } catch {
    result.notes.push('hooks.json is not valid JSON — left untouched');
    return result;
  }

  const automations: AutomationsConfig['automations'] = {};
  for (const [event, matchers] of Object.entries(legacy.hooks ?? {})) {
    if (!Array.isArray(matchers)) continue;
    if (!KNOWN_EVENTS.has(event)) {
      result.notes.push(`unknown event "${event}" skipped (${matchers.length} matcher(s))`);
      continue;
    }

    const converted: AutomationMatcher[] = [];
    for (const m of matchers) {
      const actions: AutomationAction[] = [];
      for (const hook of m.hooks ?? []) {
        if (hook.type === 'prompt' && typeof hook.prompt === 'string') {
          actions.push({ type: 'prompt', prompt: hook.prompt });
        } else if (hook.type === 'command') {
          result.droppedCommandHooks++;
          result.notes.push(
            `dropped command hook on ${event}: "${String(hook.command ?? '').slice(0, 80)}" — v2 has no command action; recreate as a webhook action if still needed`,
          );
        }
      }
      if (actions.length === 0) continue;

      converted.push({
        id: generateShortId(),
        name: m.name ?? m._scheduleName,
        matcher: m.matcher,
        cron: m.cron,
        timezone: m.timezone,
        permissionMode: m.permissionMode,
        labels: m.labels,
        enabled: m.enabled,
        actions,
      });
      if (m.workingDirectory) {
        result.notes.push(`workingDirectory "${m.workingDirectory}" on ${event} dropped (not supported by automations v2)`);
      }
    }
    if (converted.length > 0) {
      automations[event as keyof AutomationsConfig['automations']] = converted;
      result.automationCount += converted.length;
    }
  }

  const candidate: AutomationsConfig = { automations };
  const parsed = AutomationsConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    result.notes.push(`converted config failed schema validation — left untouched: ${parsed.error.message.slice(0, 200)}`);
    return result;
  }

  writeFileSync(automationsPath, JSON.stringify(candidate, null, 2), 'utf-8');
  renameSync(legacyPath, `${legacyPath}.migrated`);
  if (result.notes.length > 0) {
    writeFileSync(
      join(workspaceRoot, 'hooks-migration-report.txt'),
      `hooks.json → automations.json migration report\n\n${result.notes.join('\n')}\n`,
      'utf-8',
    );
  }
  result.migrated = true;
  return result;
}
