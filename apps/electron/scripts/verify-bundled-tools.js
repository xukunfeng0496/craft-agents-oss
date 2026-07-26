#!/usr/bin/env node

/**
 * Verification script for bundled tools on Windows
 * Checks that the agent toolchain (Git, Python, Node) and the uv document-tool
 * binary are present after `tools:download`.
 */

import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESOURCES_DIR = join(__dirname, '..', 'resources');
const TOOLS_DIR = join(RESOURCES_DIR, 'tools');
const BIN_DIR = join(RESOURCES_DIR, 'bin');

// Each entry's rel path is resolved against its base dir. Toolchain lives under
// resources/tools/; uv lives under resources/bin/<platform>/ (index.ts CRAFT_UV).
const REQUIRED_FILES = [
  { base: TOOLS_DIR, rel: 'mingit/cmd/git.exe' },
  { base: TOOLS_DIR, rel: 'python/python.exe' },
  { base: TOOLS_DIR, rel: 'node/node.exe' },
  { base: BIN_DIR, rel: 'win32-x64/uv.exe' },
];

let allFilesFound = true;

console.log('Verifying bundled tools...\n');

for (const { base, rel } of REQUIRED_FILES) {
  const filePath = join(base, rel);
  const exists = existsSync(filePath);

  if (exists) {
    const stats = statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`✓ ${rel} (${sizeMB} MB)`);
  } else {
    console.error(`✗ ${rel} - NOT FOUND`);
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
