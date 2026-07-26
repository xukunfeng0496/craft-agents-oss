/**
 * Skill Variables Runtime (CVTE)
 *
 * On v0.10.3 skills reach the model via read-before-execute: the agent is
 * directed to Read SKILL.md from disk. For skills that declare `vars`, we
 * copy the skill directory to a temp location with {{VAR}} placeholders
 * substituted in every markdown file, and point the read directive at the
 * copy — the model never sees the placeholders or knows about substitution.
 *
 * Copies are keyed by skill slug under the OS temp dir; values are
 * workspace-scoped so concurrent sessions of the same workspace share the
 * same substituted content. Re-prepared on every chat turn that mentions
 * the skill, so value changes apply immediately.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LoadedSkill } from './types.ts';
import { substituteSkillVars } from './vars-substitution.ts';
import { getSkillVars } from './vars-storage.ts';

const RUNTIME_ROOT = join(tmpdir(), 'cvte-skill-vars');

function substituteMarkdownFiles(dir: string, skill: LoadedSkill, values: Record<string, string>): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      substituteMarkdownFiles(fullPath, skill, values);
    } else if (entry.endsWith('.md')) {
      const content = readFileSync(fullPath, 'utf-8');
      const substituted = substituteSkillVars(content, skill.metadata.vars, values);
      if (substituted !== content) {
        writeFileSync(fullPath, substituted, 'utf-8');
      }
    }
  }
}

/**
 * Prepare a substituted copy of a var-bearing skill directory.
 * Returns the SKILL.md path inside the copy. Falls back to the original
 * path on any filesystem error — a skill with visible placeholders is
 * better than a failed turn.
 */
export async function prepareSubstitutedSkillCopy(
  skill: LoadedSkill,
  workspaceId: string,
): Promise<string> {
  const originalSkillMd = join(skill.path, 'SKILL.md');
  const vars = skill.metadata.vars;
  if (!vars?.length) return originalSkillMd;

  try {
    const values = await getSkillVars(workspaceId, skill.slug, vars.map((v) => v.name));
    const targetDir = join(RUNTIME_ROOT, workspaceId, skill.slug);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
    cpSync(skill.path, targetDir, { recursive: true });
    substituteMarkdownFiles(targetDir, skill, values);
    const copiedSkillMd = join(targetDir, 'SKILL.md');
    return existsSync(copiedSkillMd) ? copiedSkillMd : originalSkillMd;
  } catch {
    return originalSkillMd;
  }
}
