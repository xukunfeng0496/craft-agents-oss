/**
 * Skill Variables Processor
 *
 * Generates a temporary "overlay" plugin directory where skill files have their
 * {{VAR_NAME}} placeholders substituted with actual values from the credential store.
 *
 * The overlay directory is registered as the highest-priority SDK plugin, so the
 * SDK sees the substituted version instead of the original SKILL.md.
 *
 * Directory structure mirrors the workspace skills layout:
 *   {overlayDir}/skills/{slug}/SKILL.md   ← substituted content
 *
 * The overlay only contains skills that have variables defined; all other skills
 * are still loaded from their original locations via the workspace plugin.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSkillVars } from './vars-storage.ts';
import { substituteSkillVars, getUnsetRequiredVars } from './vars-substitution.ts';
import type { LoadedSkill } from './types.ts';
import { debug } from '../utils/debug.ts';

/**
 * Build the substituted SKILL.md content (frontmatter + body) for a skill.
 */
function buildSkillFileContent(skill: LoadedSkill, substitutedBody: string): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${skill.metadata.name}`);
  lines.push(`description: ${skill.metadata.description}`);

  if (skill.metadata.icon) {
    lines.push(`icon: ${skill.metadata.icon}`);
  }
  if (skill.metadata.globs && skill.metadata.globs.length > 0) {
    lines.push('globs:');
    for (const g of skill.metadata.globs) lines.push(`  - ${g}`);
  }
  if (skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0) {
    lines.push('alwaysAllow:');
    for (const t of skill.metadata.alwaysAllow) lines.push(`  - ${t}`);
  }
  if (skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0) {
    lines.push('requiredSources:');
    for (const s of skill.metadata.requiredSources) lines.push(`  - ${s}`);
  }
  // Note: vars field is intentionally omitted from the substituted file —
  // the SDK doesn't need to know about the variable definitions.

  lines.push('---');
  lines.push('');
  lines.push(substitutedBody);

  return lines.join('\n');
}

/**
 * Write a single substituted skill into the overlay directory.
 */
async function writeSkillToOverlay(
  overlaySkillsDir: string,
  skill: LoadedSkill,
  workspaceId: string
): Promise<{ slug: string; unsetRequired: string[] }> {
  const varNames = skill.metadata.vars!.map((v) => v.name);
  const varValues = await getSkillVars(workspaceId, skill.slug, varNames);
  const unsetRequired = getUnsetRequiredVars(skill.metadata.vars!, varValues);

  const substitutedBody = substituteSkillVars(skill.content, skill.metadata.vars, varValues);
  const fileContent = buildSkillFileContent(skill, substitutedBody);

  const skillDir = join(overlaySkillsDir, skill.slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), fileContent, 'utf-8');

  if (unsetRequired.length > 0) {
    debug(`[SkillVarsProcessor] Skill "${skill.slug}" has unset required vars: ${unsetRequired.join(', ')}`);
  }

  return { slug: skill.slug, unsetRequired };
}

/**
 * Result returned by prepareSkillVarsOverlay.
 */
export interface SkillVarsOverlayResult {
  /** Absolute path to the overlay plugin directory to pass to the SDK. */
  overlayPath: string;
  /** Skills that still have unset required variables after processing. */
  unsetBySkill: Record<string, string[]>;
  /** Clean up the temp directory when the session ends. */
  cleanup: () => void;
}

/**
 * Read the plugin name from a workspace's .claude-plugin/plugin.json.
 * This must match so overlay skills get the same qualified name as workspace skills.
 */
function readWorkspacePluginName(workspaceRootPath: string): string {
  try {
    const manifestPath = join(workspaceRootPath, '.claude-plugin', 'plugin.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) return manifest.name;
    }
  } catch {
    // Fall through to default
  }
  return 'skill-vars-overlay';
}

/**
 * Prepare a temporary overlay directory containing substituted skill files.
 *
 * Call this once per agent session, then register `result.overlayPath` as the
 * **first** (highest-priority) entry in the SDK `plugins` array.
 *
 * IMPORTANT: The overlay's plugin.json name MUST match the workspace plugin name.
 * The SDK qualifies skills as `{pluginName}:{skillSlug}`. PreToolUse qualifies
 * user input using the workspace plugin name. If the overlay uses a different name,
 * the SDK's `.find()` will skip the overlay and use the original (unsubstituted) skill.
 * By using the same name and placing the overlay first in the plugins array,
 * `.find()` returns the substituted version.
 *
 * @param skills - All loaded skills (from loadAllSkills)
 * @param workspaceId - Workspace ID used to look up variable values
 * @param workspaceRootPath - Workspace root path to read plugin name from
 * @returns Overlay result, or null if no skills have variables
 */
export async function prepareSkillVarsOverlay(
  skills: LoadedSkill[],
  workspaceId: string,
  workspaceRootPath: string
): Promise<SkillVarsOverlayResult | null> {
  const skillsWithVars = skills.filter(
    (s) => s.metadata.vars && s.metadata.vars.length > 0
  );

  if (skillsWithVars.length === 0) {
    return null; // Nothing to do
  }

  // Create temp dir: /tmp/wa-skill-vars-XXXXXX/
  const tempBase = join(tmpdir(), `wa-skill-vars-${Date.now()}`);
  // SDK looks for skills under {pluginDir}/skills/{slug}/SKILL.md
  const overlaySkillsDir = join(tempBase, 'skills');
  mkdirSync(overlaySkillsDir, { recursive: true });

  // SDK requires .claude-plugin/plugin.json for inline plugin discovery (--plugin-dir).
  // The plugin name MUST match the workspace plugin name so that skill qualified names
  // (e.g., "craft-workspace-my-workspace:test-vars") are identical between overlay and
  // workspace. This ensures SDK's .find() returns the overlay (substituted) version first.
  const workspacePluginName = readWorkspacePluginName(workspaceRootPath);
  const pluginDir = join(tempBase, '.claude-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({ name: workspacePluginName, version: '1.0.0' }),
    'utf-8'
  );

  debug(`[SkillVarsProcessor] Creating overlay at ${tempBase} for ${skillsWithVars.length} skills (pluginName: ${workspacePluginName})`);

  const unsetBySkill: Record<string, string[]> = {};

  await Promise.all(
    skillsWithVars.map(async (skill) => {
      const result = await writeSkillToOverlay(overlaySkillsDir, skill, workspaceId);
      if (result.unsetRequired.length > 0) {
        unsetBySkill[result.slug] = result.unsetRequired;
      }
    })
  );

  return {
    overlayPath: tempBase,
    unsetBySkill,
    cleanup: () => {
      try {
        if (existsSync(tempBase)) {
          rmSync(tempBase, { recursive: true, force: true });
          debug(`[SkillVarsProcessor] Cleaned up overlay at ${tempBase}`);
        }
      } catch (err) {
        debug(`[SkillVarsProcessor] Failed to clean up overlay: ${err}`);
      }
    },
  };
}
