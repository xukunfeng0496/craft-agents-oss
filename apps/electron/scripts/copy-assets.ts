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

import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

const RESOURCES_SRC = resolve('resources');
const DIST_RESOURCES_DEST = 'dist/resources';
const TOOLS_SRC = join(RESOURCES_SRC, 'tools');
const DIST_TOOLS_ARCHIVES_DEST = 'dist/tools-archives';

function shouldCopyResource(src: string): boolean {
  const relativePath = relative(RESOURCES_SRC, resolve(src));
  if (!relativePath || relativePath === '') {
    return true;
  }

  const normalizedPath = relativePath.split(sep).join('/');

  // Windows bundled tools are packaged separately via electron-builder extraResources.
  // Keeping them out of dist/resources avoids shipping an extra copy inside the app bundle.
  if (normalizedPath === 'tools' || normalizedPath.startsWith('tools/')) {
    return false;
  }

  return true;
}

function createWindowsToolArchives(): void {
  rmSync(DIST_TOOLS_ARCHIVES_DEST, { recursive: true, force: true });

  if (!existsSync(TOOLS_SRC)) {
    console.log('ℹ No resources/tools directory found; skipping Windows tool archive build');
    return;
  }

  mkdirSync(DIST_TOOLS_ARCHIVES_DEST, { recursive: true });

  const archives = ['mingit', 'python']
    .map((name) => {
      const sourceDir = join(TOOLS_SRC, name);
      if (!existsSync(sourceDir)) {
        return null;
      }

      const zipPath = join(DIST_TOOLS_ARCHIVES_DEST, `${name}.zip`);
      const zip = new AdmZip();
      zip.addLocalFolder(sourceDir, name);
      zip.writeZip(zipPath);

      const archiveBuffer = readFileSync(zipPath);
      return {
        name,
        file: `${name}.zip`,
        size: archiveBuffer.length,
        sha256: createHash('sha256').update(archiveBuffer).digest('hex'),
      };
    })
    .filter((archive): archive is { name: string; file: string; size: number; sha256: string } => archive !== null);

  if (archives.length === 0) {
    console.log('ℹ No Windows bundled tools found; skipping archive manifest');
    return;
  }

  writeFileSync(
    join(DIST_TOOLS_ARCHIVES_DEST, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, archives }, null, 2)}\n`,
    'utf8',
  );

  console.log('✓ Created Windows tool archives → dist/tools-archives/');
}

// Copy bundled app resources used at runtime (icons, themes, docs, permissions, tool-icons, etc.)
rmSync(DIST_RESOURCES_DEST, { recursive: true, force: true });
cpSync(RESOURCES_SRC, DIST_RESOURCES_DEST, { recursive: true, filter: shouldCopyResource });

console.log('✓ Copied resources/ → dist/resources/');

// Copy i18n locale files for main process (renderer bundles them via Vite)
// Source: packages/shared/locales/ → dist/resources/locales/
const localesSrc = join('..', '..', 'packages', 'shared', 'locales');
const localesDest = join('dist', 'resources', 'locales');
cpSync(localesSrc, localesDest, { recursive: true });
console.log('✓ Copied locales/ → dist/resources/locales/');

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

createWindowsToolArchives();
