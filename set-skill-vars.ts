/**
 * Manually set skill variables for testing
 * Usage: bun run set-skill-vars.ts <workspaceId> <skillSlug>
 */

import { setSkillVars } from './packages/shared/src/skills/vars-storage.ts';

async function main() {
  const [,, workspaceId, skillSlug] = process.argv;

  if (!workspaceId || !skillSlug) {
    console.error('Usage: bun run set-skill-vars.ts <workspaceId> <skillSlug>');
    process.exit(1);
  }

  console.log(`\n=== Setting Skill Variables ===`);
  console.log(`Workspace ID: ${workspaceId}`);
  console.log(`Skill Slug: ${skillSlug}\n`);

  // Set test values
  const testValues = {
    MY_NAME: '测试用户',
    MY_TEAM: 'CVTE研发团队',
    SECRET_KEY: 'sk-test-abc123xyz',
  };

  console.log('Setting values:');
  Object.entries(testValues).forEach(([key, value]) => {
    console.log(`  ${key} = "${value}"`);
  });

  try {
    await setSkillVars(workspaceId, skillSlug, testValues);
    console.log('\n✅ Variables saved successfully!');
  } catch (err) {
    console.error('\n❌ Failed to save variables:', err);
    process.exit(1);
  }

  // Verify by reading back
  console.log('\nVerifying...');
  const { getSkillVars } = await import('./packages/shared/src/skills/vars-storage.ts');
  const saved = await getSkillVars(workspaceId, skillSlug, Object.keys(testValues));

  console.log('\nSaved values:');
  Object.entries(testValues).forEach(([key]) => {
    const value = saved[key];
    if (value) {
      console.log(`  ✓ ${key} = "${value}"`);
    } else {
      console.log(`  ✗ ${key} = (not saved)`);
    }
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
