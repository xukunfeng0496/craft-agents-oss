#!/usr/bin/env node

/**
 * Test script for bundled skills functionality
 *
 * This script simulates the bundled skills initialization process
 * to verify it works correctly before building the app.
 */

const { join } = require('path');
const { existsSync, mkdirSync, cpSync, readdirSync, rmSync } = require('fs');
const { homedir } = require('os');

const BUNDLED_SKILLS_PATH = join(__dirname, '../resources/bundled-skills');
const TEST_WORKSPACE_DIR = join(homedir(), '.workagent', 'workspaces', '.test-workspace');
const TEST_SKILLS_DIR = join(TEST_WORKSPACE_DIR, 'skills');

console.log('🧪 Testing Bundled Skills Functionality\n');

// Check if bundled skills directory exists
if (!existsSync(BUNDLED_SKILLS_PATH)) {
  console.error('❌ Bundled skills directory not found:', BUNDLED_SKILLS_PATH);
  process.exit(1);
}

console.log('✅ Bundled skills directory found:', BUNDLED_SKILLS_PATH);

// Read all skill directories
const entries = readdirSync(BUNDLED_SKILLS_PATH, { withFileTypes: true });
const skillDirs = entries.filter(entry =>
  entry.isDirectory() && entry.name !== '.git' && !entry.name.startsWith('.')
);

console.log(`✅ Found ${skillDirs.length} bundled skills:\n`);

// Validate each skill
let validCount = 0;
let invalidCount = 0;

for (const entry of skillDirs) {
  const skillPath = join(BUNDLED_SKILLS_PATH, entry.name);
  const skillFile = join(skillPath, 'SKILL.md');
  const iconFile = join(skillPath, 'icon.svg');

  const hasSkillMd = existsSync(skillFile);
  const hasIcon = existsSync(iconFile);

  if (hasSkillMd) {
    console.log(`  ✅ ${entry.name}`);
    if (hasIcon) {
      console.log(`     └─ Has icon.svg`);
    }
    validCount++;
  } else {
    console.log(`  ❌ ${entry.name} - Missing SKILL.md`);
    invalidCount++;
  }
}

console.log(`\n📊 Summary: ${validCount} valid, ${invalidCount} invalid\n`);

if (invalidCount > 0) {
  console.error('❌ Some skills are invalid. Please fix them before building.');
  process.exit(1);
}

// Test installation (dry run)
console.log('🔍 Testing installation process (dry run)...\n');

// Ensure test directory exists
if (existsSync(TEST_WORKSPACE_DIR)) {
  rmSync(TEST_WORKSPACE_DIR, { recursive: true });
}
mkdirSync(TEST_SKILLS_DIR, { recursive: true });

// Try copying one skill as a test
const testSkill = skillDirs[0];
const sourcePath = join(BUNDLED_SKILLS_PATH, testSkill.name);
const destPath = join(TEST_SKILLS_DIR, testSkill.name);

try {
  cpSync(sourcePath, destPath, { recursive: true });
  console.log(`✅ Successfully copied test skill: ${testSkill.name}`);

  // Verify the copy
  const copiedSkillFile = join(destPath, 'SKILL.md');
  if (existsSync(copiedSkillFile)) {
    console.log('✅ SKILL.md exists in copied directory');
  } else {
    console.error('❌ SKILL.md not found in copied directory');
    process.exit(1);
  }

  // Clean up test directory
  rmSync(TEST_WORKSPACE_DIR, { recursive: true });
  console.log('✅ Test directory cleaned up\n');
} catch (error) {
  console.error('❌ Failed to copy test skill:', error.message);
  process.exit(1);
}

// Check for Windows compatibility issues
console.log('🪟 Checking Windows compatibility...\n');

let windowsIssues = 0;

for (const entry of skillDirs) {
  const skillPath = join(BUNDLED_SKILLS_PATH, entry.name);

  // Check for problematic files
  const checkPath = (dir) => {
    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const itemPath = join(dir, item.name);

      // Check for .DS_Store
      if (item.name === '.DS_Store') {
        console.log(`  ⚠️  ${entry.name}: Contains .DS_Store file`);
        windowsIssues++;
      }

      // Check for __pycache__
      if (item.name === '__pycache__') {
        console.log(`  ⚠️  ${entry.name}: Contains __pycache__ directory`);
        windowsIssues++;
      }

      // Check for files with special characters
      if (item.name.includes(':') || item.name.includes('*') || item.name.includes('?')) {
        console.log(`  ⚠️  ${entry.name}: Contains file with special characters: ${item.name}`);
        windowsIssues++;
      }

      // Recurse into directories
      if (item.isDirectory() && item.name !== '__pycache__') {
        checkPath(itemPath);
      }
    }
  };

  checkPath(skillPath);
}

if (windowsIssues === 0) {
  console.log('✅ No Windows compatibility issues found\n');
} else {
  console.log(`\n⚠️  Found ${windowsIssues} potential Windows compatibility issues\n`);
}

// Final summary
console.log('═══════════════════════════════════════════════════════════');
console.log('✅ All tests passed!');
console.log('═══════════════════════════════════════════════════════════');
console.log(`\n📦 Ready to bundle ${validCount} skills into the app\n`);
console.log('Next steps:');
console.log('  1. Run: bun run electron:build');
console.log('  2. Install the app');
console.log('  3. Create a workspace');
console.log('  4. Check {workspace}/skills/ for bundled skills\n');
