#!/usr/bin/env node

/**
 * Verification script for bundled tools on Windows
 * Checks if required tools (Git, Bash, Python) are present in resources/tools/
 */

import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOOLS_DIR = join(__dirname, '..', 'resources', 'tools');

const REQUIRED_FILES = [
  'mingit/cmd/git.exe',
  'python/python.exe'
];

let allFilesFound = true;

console.log('Verifying bundled tools...\n');

for (const file of REQUIRED_FILES) {
  const filePath = join(TOOLS_DIR, file);
  const exists = existsSync(filePath);

  if (exists) {
    const stats = statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`✓ ${file} (${sizeMB} MB)`);
  } else {
    console.error(`✗ ${file} - NOT FOUND`);
    allFilesFound = false;
  }
}

console.log('');

if (allFilesFound) {
  console.log('All required tools are present.');
  process.exit(0);
} else {
  console.error('Some required tools are missing. Run "bun run tools:download" to download them.');
  process.exit(1);
}
