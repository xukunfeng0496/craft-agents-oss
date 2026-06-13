/**
 * CVTE one-shot migration (D10): legacy global skills directory
 * `~/.workagent/skills/` → upstream's `~/.agents/skills/`.
 *
 * Upstream moved the global agent-skills directory to `~/.agents/skills`
 * (Issue #171). Legacy CVTE installs (v0.7.1 and earlier) stored user skills
 * under `~/.workagent/skills`, which the new build never reads — every
 * existing user's skills silently disappear from the UI on upgrade.
 *
 * This copies each legacy skill folder into the new location on first launch:
 *   - **Copy, not move** — the original `~/.workagent/skills` is preserved as a
 *     backup (the user can delete it manually once satisfied).
 *   - **Never clobber** — a slug that already exists in `~/.agents/skills`
 *     (the user re-created it on the new build) is skipped, not overwritten.
 *   - **Idempotent** — a sentinel file in CONFIG_DIR marks completion, so the
 *     scan runs exactly once. The marker lives outside the skills dir so it
 *     can't be mistaken for a skill folder.
 *   - **Best-effort** — any failure is recorded in the result notes and never
 *     throws; skill migration must not block startup.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/paths.ts';
import { GLOBAL_AGENT_SKILLS_DIR } from './storage.ts';

/** Legacy global skills directory: ~/.workagent/skills/ */
const LEGACY_GLOBAL_SKILLS_DIR = join(CONFIG_DIR, 'skills');

/** Sentinel marking that the one-shot migration already ran (kept out of the skills dir). */
const MIGRATION_MARKER = join(CONFIG_DIR, '.global-skills-migrated');

export interface SkillsDirMigrationResult {
  migrated: boolean;
  copiedSlugs: string[];
  /** Slugs already present in the new dir — left untouched. */
  skippedSlugs: string[];
  notes: string[];
}

/**
 * Migrate `~/.workagent/skills` → `~/.agents/skills` once, on first launch of
 * the new build. No-op (and cheap) when the marker exists or there is no legacy
 * directory — safe to call unconditionally at startup.
 */
export function migrateLegacyGlobalSkills(): SkillsDirMigrationResult {
  const result: SkillsDirMigrationResult = {
    migrated: false,
    copiedSlugs: [],
    skippedSlugs: [],
    notes: [],
  };

  // Idempotent: the marker means we already migrated (or found nothing to do).
  if (existsSync(MIGRATION_MARKER)) return result;
  // Nothing to migrate (fresh install, or a user who never had legacy skills).
  if (!existsSync(LEGACY_GLOBAL_SKILLS_DIR)) return result;

  let entries: Dirent[];
  try {
    entries = readdirSync(LEGACY_GLOBAL_SKILLS_DIR, { withFileTypes: true });
  } catch (error) {
    result.notes.push(`could not read ${LEGACY_GLOBAL_SKILLS_DIR}: ${String(error)}`);
    return result;
  }

  try {
    mkdirSync(GLOBAL_AGENT_SKILLS_DIR, { recursive: true });
  } catch (error) {
    result.notes.push(`could not create ${GLOBAL_AGENT_SKILLS_DIR}: ${String(error)} — migration aborted`);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const src = join(LEGACY_GLOBAL_SKILLS_DIR, slug);

    // Only migrate real skills (a folder carrying a SKILL.md).
    if (!existsSync(join(src, 'SKILL.md'))) {
      result.notes.push(`${slug}: no SKILL.md — skipped (not a skill folder)`);
      continue;
    }

    const dest = join(GLOBAL_AGENT_SKILLS_DIR, slug);
    if (existsSync(dest)) {
      // User already has this slug on the new build — never overwrite.
      result.skippedSlugs.push(slug);
      continue;
    }

    try {
      cpSync(src, dest, { recursive: true });
      result.copiedSlugs.push(slug);
    } catch (error) {
      result.notes.push(`${slug}: copy failed — ${String(error)}`);
    }
  }

  // Mark complete regardless of per-skill outcomes so we never rescan. The
  // original directory is intentionally left in place as a backup.
  try {
    writeFileSync(
      MIGRATION_MARKER,
      [
        `Legacy global skills migrated from ${LEGACY_GLOBAL_SKILLS_DIR} to ${GLOBAL_AGENT_SKILLS_DIR}.`,
        `copied: ${result.copiedSlugs.join(', ') || '(none)'}`,
        `skipped (already present): ${result.skippedSlugs.join(', ') || '(none)'}`,
        ...(result.notes.length > 0 ? ['notes:', ...result.notes] : []),
        `The original ${LEGACY_GLOBAL_SKILLS_DIR} was kept as a backup and can be deleted manually.`,
        '',
      ].join('\n'),
      'utf-8',
    );
  } catch (error) {
    result.notes.push(`could not write migration marker: ${String(error)}`);
  }

  result.migrated = result.copiedSlugs.length > 0;
  return result;
}
