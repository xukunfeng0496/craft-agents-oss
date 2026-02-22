/**
 * Release Notes Utilities
 *
 * Loads release notes from bundled assets and syncs them to ~/.workagent/release-notes/.
 * Follows the same pattern as docs/index.ts.
 *
 * Source content lives in apps/electron/resources/release-notes/*.md.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';

const CONFIG_DIR = join(homedir(), '.workagent');
const RELEASE_NOTES_DIR = join(CONFIG_DIR, 'release-notes');

let releaseNotesInitialized = false;

function getAssetsDir(locale?: string): string {
  const base = getBundledAssetsDir('release-notes')
    ?? join(process.cwd(), 'resources', 'release-notes');
  if (locale && locale !== 'en') {
    const localeDir = join(base, locale);
    if (existsSync(localeDir)) return localeDir;
  }
  return base;
}

/**
 * Load bundled release notes from asset files.
 * Returns { filename → content } map.
 */
function loadBundledReleaseNotes(locale?: string): Record<string, string> {
  const assetsDir = getAssetsDir(locale);
  const notes: Record<string, string> = {};

  let files: string[];
  try {
    files = existsSync(assetsDir) ? readdirSync(assetsDir).filter(f => f.endsWith('.md')) : [];
  } catch {
    console.warn(`[release-notes] Could not read assets dir: ${assetsDir}`);
    return notes;
  }

  for (const filename of files) {
    const filePath = join(assetsDir, filename);
    try {
      notes[filename] = readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`[release-notes] Failed to load ${filename}:`, error);
    }
  }

  return notes;
}

const _bundledNotesCache: Record<string, Record<string, string>> = {};

function getBundledReleaseNotes(locale?: string): Record<string, string> {
  const key = locale ?? 'default';
  if (!_bundledNotesCache[key]) {
    _bundledNotesCache[key] = loadBundledReleaseNotes(locale);
  }
  return _bundledNotesCache[key]!;
}

/**
 * Initialize release notes directory with bundled content.
 * Call at app startup alongside initializeDocs().
 */
export function initializeReleaseNotes(): void {
  if (releaseNotesInitialized) return;
  releaseNotesInitialized = true;

  if (!existsSync(RELEASE_NOTES_DIR)) {
    mkdirSync(RELEASE_NOTES_DIR, { recursive: true });
  }

  const bundledNotes = getBundledReleaseNotes();
  for (const [filename, content] of Object.entries(bundledNotes)) {
    const notePath = join(RELEASE_NOTES_DIR, filename);
    writeFileSync(notePath, content, 'utf-8');
  }

  debug(`[release-notes] Synced ${Object.keys(bundledNotes).length} release notes`);
}

/**
 * Parse version from filename (e.g., "0.4.1.md" → "0.4.1").
 */
function parseVersion(filename: string): string {
  return filename.replace(/\.md$/, '');
}

/**
 * Compare semver strings for sorting (descending — newest first).
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/** Maximum number of release notes to display in the UI. */
const MAX_DISPLAY_NOTES = 10;

export interface ReleaseNote {
  version: string;
  content: string;
}

/**
 * Get release notes sorted newest-first, limited to the most recent 10.
 * If locale is specified, looks for locale-specific files in a subdirectory (e.g. resources/release-notes/zh-CN/).
 * Falls back to the default (English) directory if the locale subdirectory doesn't exist.
 */
export function getReleaseNotesList(locale?: string): ReleaseNote[] {
  const notes = getBundledReleaseNotes(locale);
  return Object.entries(notes)
    .map(([filename, content]) => ({
      version: parseVersion(filename),
      content,
    }))
    .sort((a, b) => compareSemver(a.version, b.version))
    .slice(0, MAX_DISPLAY_NOTES);
}

/**
 * Get the latest release note version string.
 */
export function getLatestReleaseVersion(): string | undefined {
  const list = getReleaseNotesList();
  return list[0]?.version;
}

/**
 * Get all release notes combined into a single markdown string.
 * Each version is separated by a horizontal rule.
 * Pass a locale (e.g. 'zh-CN') to load locale-specific notes if available.
 */
export function getCombinedReleaseNotes(locale?: string): string {
  const list = getReleaseNotesList(locale);
  return list.map(n => n.content).join('\n\n---\n\n');
}
