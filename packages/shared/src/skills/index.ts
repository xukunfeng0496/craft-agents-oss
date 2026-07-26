/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  invalidateSkillsCache,
  loadSkillBySlug,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';

// CVTE: skill variables ({{VAR}} substitution)
export * from './vars-storage.ts';
export * from './vars-substitution.ts';
export * from './vars-runtime.ts';

// CVTE D10: one-shot ~/.workagent/skills → ~/.agents/skills migration
export * from './migrate-skills-dir.ts';
