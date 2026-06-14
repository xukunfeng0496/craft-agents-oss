/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/.
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, copyFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

// cpSync is additive — it never deletes files removed from resources/. Release
// notes are a curated, replace-not-append set (CVTE notes, not upstream's), so a
// previously-built dist/ would keep stale .md files and "最新动态" would still show
// them. Clear that dir first so it mirrors source exactly.
rmSync('dist/resources/release-notes', { recursive: true, force: true });

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
cpSync('resources', 'dist/resources', { recursive: true });

console.log('✓ Copied resources/ → dist/resources/');

// CVTE: build & stage the subprocess servers. The upstream OSS tag commits a
// prebuilt bridge-mcp-server bundle into resources/ but never stages
// pi-agent-server / session-mcp-server, so packaged builds fail with
// "piServerPath not configured" on any Pi (openai-compatible) connection.
// runtime-resolver looks for <appRoot>/dist/resources/<name>/index.js.
for (const server of ['pi-agent-server', 'session-mcp-server']) {
  const pkgDir = join('..', '..', 'packages', server);
  execFileSync('bun', ['run', 'build'], { cwd: pkgDir, stdio: 'inherit' });
  cpSync(join(pkgDir, 'dist'), join('dist', 'resources', server), { recursive: true });
  console.log(`✓ Built & staged ${server} → dist/resources/${server}/`);
}

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}
