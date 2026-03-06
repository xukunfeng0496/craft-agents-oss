import { getSkillVars } from './packages/shared/src/skills/vars-storage.ts';
import { loadSkillBySlug } from './packages/shared/src/skills/storage.ts';
import { substituteSkillVars } from './packages/shared/src/skills/vars-substitution.ts';
import { homedir } from 'os';

const workspaceId = '8be58b5a-be7c-1ac7-3e10-1b24654339f2';
const skillSlug = 'test-vars';
const workspaceRoot = `${homedir()}/.workagent/workspaces/my-workspace`;

console.log('=== Final Test ===');
console.log(`Workspace: ${workspaceRoot}`);
console.log(`Skill: ${skillSlug}\n`);

const skill = loadSkillBySlug(workspaceRoot, skillSlug);
if (!skill) {
  console.error('❌ Skill not found');
  process.exit(1);
}

console.log(`✓ Skill loaded: ${skill.metadata.name}\n`);

const varNames = skill.metadata.vars!.map(v => v.name);
const varValues = await getSkillVars(workspaceId, skillSlug, varNames);

console.log('Stored values:');
for (const name of varNames) {
  const value = varValues[name];
  console.log(`  ${name}: ${value || '(not set)'}`);
}

const substituted = substituteSkillVars(skill.content, skill.metadata.vars, varValues);
const remaining = substituted.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);

console.log(`\n${remaining ? '⚠️  Placeholders remain' : '✅ All substituted'}`);
if (remaining) {
  console.log('Remaining:', [...new Set(remaining)].join(', '));
}

console.log('\n=== Substituted preview ===');
console.log(substituted.substring(0, 400));
