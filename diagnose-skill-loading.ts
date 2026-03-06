/**
 * Diagnose skill loading issues
 */

import { loadAllSkills } from './packages/shared/src/skills/storage.ts';
import { homedir } from 'os';

const workspaceRoot = `${homedir()}/.workagent/workspaces/my-workspace`;

console.log('=== Skill Loading Diagnosis ===\n');
console.log(`Workspace root: ${workspaceRoot}\n`);

try {
  const skills = loadAllSkills(workspaceRoot);

  console.log(`✓ Loaded ${skills.length} skills:\n`);

  skills.forEach(skill => {
    console.log(`  - ${skill.slug}`);
    console.log(`    Name: ${skill.metadata.name}`);
    console.log(`    Path: ${skill.path}`);
    if (skill.metadata.vars && skill.metadata.vars.length > 0) {
      console.log(`    Variables: ${skill.metadata.vars.map(v => v.name).join(', ')}`);
    }
    console.log('');
  });

  // Check specifically for test-vars
  const testVars = skills.find(s => s.slug === 'test-vars');
  if (testVars) {
    console.log('✅ test-vars skill found!');
    console.log(`   Qualified name should be: my-workspace:test-vars`);
  } else {
    console.log('❌ test-vars skill NOT found in loaded skills');
  }

} catch (err) {
  console.error('❌ Failed to load skills:', err);
  process.exit(1);
}
