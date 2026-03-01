import { debug } from '../utils/debug.ts';

/**
 * Get skill variables context for system prompt.
 * Lists skills that have unset required variables.
 *
 * @param workspaceId - Workspace ID for loading variable values
 * @param workspaceRoot - Workspace root path
 * @param projectRoot - Optional project root for project-level skills
 * @returns Formatted context string, or empty if no issues
 */
export async function getSkillVariablesContext(
  workspaceId: string,
  workspaceRoot: string,
  projectRoot?: string
): Promise<string> {
  try {
    const { loadAllSkills, getSkillVars, getUnsetRequiredVars } = await import('../skills/index.ts');

    // Load all skills
    const skills = loadAllSkills(workspaceRoot, projectRoot);

    // Filter skills with variables
    const skillsWithVars = skills.filter(
      (s: { metadata: { vars?: { name: string; required?: boolean }[] } }) =>
        s.metadata.vars && s.metadata.vars.length > 0
    );

    if (skillsWithVars.length === 0) {
      return ''; // No skills with variables
    }

    // Check each skill for unset required variables
    const skillsNeedingConfig: { slug: string; name: string; unsetVars: string[] }[] = [];

    for (const skill of skillsWithVars) {
      const varNames = skill.metadata.vars!.map((v: { name: string }) => v.name);
      const varValues = await getSkillVars(workspaceId, skill.slug, varNames);
      const unsetRequired = getUnsetRequiredVars(skill.metadata.vars!, varValues);

      if (unsetRequired.length > 0) {
        skillsNeedingConfig.push({
          slug: skill.slug,
          name: skill.metadata.name,
          unsetVars: unsetRequired,
        });
      }
    }

    if (skillsNeedingConfig.length === 0) {
      return ''; // All variables configured
    }

    // Generate warning list
    const warnings = skillsNeedingConfig.map(skill => {
      const varList = skill.unsetVars.map(v => `\`${v}\``).join(', ');
      return `- **${skill.name}** (\`${skill.slug}\`): requires ${varList}`;
    }).join('\n');

    return `

## Skill Variables Configuration

The following skills require variable configuration before use:

${warnings}

**Important:** When a user tries to invoke these skills, inform them that variables need to be configured first. Direct them to Settings > Skills > [Skill Name] > Variables section to configure the required values.`;
  } catch (err) {
    debug('[getSkillVariablesContext] Error loading skill variables:', err);
    return ''; // Fail silently to not break system prompt generation
  }
}
