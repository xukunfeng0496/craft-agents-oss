#!/usr/bin/env node
/**
 * Debug script to check skill variables storage and substitution
 * Usage: node debug-skill-vars.js <workspaceId> <skillSlug>
 */

const { getSkillVars } = require('./packages/shared/dist/skills/vars-storage.js');
const { loadSkillBySlug } = require('./packages/shared/dist/skills/storage.js');
const { substituteSkillVars } = require('./packages/shared/dist/skills/vars-substitution.js');

async function main() {
  const [,, workspaceId, skillSlug] = process.argv;

  if (!workspaceId || !skillSlug) {
    console.error('Usage: node debug-skill-vars.js <workspaceId> <skillSlug>');
    process.exit(1);
  }

  console.log(`\n=== Debugging Skill Variables ===`);
  console.log(`Workspace ID: ${workspaceId}`);
  console.log(`Skill Slug: ${skillSlug}\n`);

  // Load skill
  const workspaceRoot = `${process.env.HOME}/.craft-agent/workspaces/${workspaceId}`;
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
    remainingPlaceholders.forEach(p => console.log(`  - ${p}`));
  } else {
    console.log(`\n✓ All placeholders substituted successfully`);
  }

  console.log(`\n=== Original Content (first 200 chars) ===`);
  console.log(skill.content.substring(0, 200));

  console.log(`\n=== Substituted Content (first 200 chars) ===`);
  console.log(substituted.substring(0, 200));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
