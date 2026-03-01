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
  loadSkillBySlug,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';

// Skill variables storage
export {
  getSkillVar,
  getSkillVars,
  setSkillVar,
  setSkillVars,
  deleteSkillVar,
  deleteSkillVars,
} from './vars-storage.ts';

// Skill variables substitution
export {
  substituteSkillVars,
  getUnsetRequiredVars,
  hasVarPlaceholders,
} from './vars-substitution.ts';

// Skill variables processor (for agent integration)
export {
  prepareSkillVarsOverlay,
  type SkillVarsOverlayResult,
} from './vars-processor.ts';
