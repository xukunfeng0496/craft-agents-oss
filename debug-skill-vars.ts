/**
 * Debug script to check skill variables storage and substitution
 * Usage: bun run debug-skill-vars.ts <workspaceId> <skillSlug>
 */

import { getSkillVars } from './packages/shared/src/skills/vars-storage.ts';
import { loadSkillBySlug } from './packages/shared/src/skills/storage.ts';
import { substituteSkillVars } from './packages/shared/src/skills/vars-substitution.ts';
import { homedir } from 'os';

async function main() {
  const [,, workspaceId, skillSlug] = process.argv;

  if (!workspaceId || !skillSlug) {
    console.error('Usage: bun run debug-skill-vars.ts <workspaceId> <skillSlug>');
    process.exit(1);
  }

  console.log(`\n=== Debugging Skill Variables ===`);
  console.log(`Workspace ID: ${workspaceId}`);
  console.log(`Skill Slug: ${skillSlug}\n`);

  // Load skill
  const workspaceRoot = `${homedir()}/.workagent/workspaces/${workspaceId}`;
  console.log(`Loading skill from: ${workspaceRoot}/skills/${skillSlug}/`);

  const skill = loadSkillBySlug(workspaceRoot, skillSlug);
  if (!skill) {
    console.error(`❌ Skill not found: ${skillSlug}`);
    process.exit(1);
  }

  console.log(`✓ Skill loaded: ${skill.metadata.name}`);

  if (!skill.metadata.vars || skill.metadata.vars.length === 0) {
    console.log(`\n⚠️  This skill has no variables defined.`);
    process.exit(0);
  }

  console.log(`\nVariables defined in SKILL.md:`);
  skill.metadata.vars.forEach(v => {
    console.log(`  - ${v.name} (required: ${v.required}, default: ${v.default || 'none'})`);
  });

  // Get variable values from storage
  const varNames = skill.metadata.vars.map(v => v.name);
  console.log(`\nFetching values from credential store...`);
  const varValues = await getSkillVars(workspaceId, skillSlug, varNames);

  console.log(`\nStored values:`);
  for (const varName of varNames) {
    const value = varValues[varName];
    if (value !== undefined) {
      console.log(`  ✓ ${varName} = "${value}"`);
    } else {
      console.log(`  ✗ ${varName} = (not set)`);
    }
  }

  // Test substitution
  console.log(`\n=== Testing Substitution ===`);
  const substituted = substituteSkillVars(skill.content, skill.metadata.vars, varValues);

  // Check if any placeholders remain
  const remainingPlaceholders = substituted.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  if (remainingPlaceholders) {
    console.log(`\n⚠️  Unsubstituted placeholders found:`);
    const unique = [...new Set(remainingPlaceholders)];
    unique.forEach(p => console.log(`  - ${p}`));
  } else {
    console.log(`\n✓ All placeholders substituted successfully`);
  }

  console.log(`\n=== Original Content (first 300 chars) ===`);
  console.log(skill.content.substring(0, 300));

  console.log(`\n=== Substituted Content (first 300 chars) ===`);
  console.log(substituted.substring(0, 300));

  console.log(`\n=== Full Substituted Content ===`);
  console.log(substituted);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
