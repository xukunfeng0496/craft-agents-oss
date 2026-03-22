/**
 * Bundled Skills Initialization
 *
 * Copies pre-installed skills from app resources to workspace skills directory
 * when a new workspace is created. This ensures users have a set of default
 * skills available without manual installation.
 */

import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, cpSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import log from './logger';
import { getPackagedContentPath } from './packaged-paths';

/** Marker file to track bundled skills installation */
const BUNDLED_SKILLS_MARKER = '.bundled-skills-installed';

/**
 * Get the path to bundled skills in the app resources.
 * Handles both development and production environments.
 */
function getBundledSkillsPath(): string {
  if (app.isPackaged) {
    // Production: bundled skills live with the rest of dist/resources.
    return getPackagedContentPath('dist', 'resources', 'bundled-skills');
  } else {
    // Development: resources are in the source tree
    return join(app.getAppPath(), 'resources', 'bundled-skills');
  }
}

/**
 * Check if bundled skills have already been installed in a workspace.
 * Uses a marker file to track installation status.
 */
function hasBundledSkillsMarker(workspaceRoot: string): boolean {
  const markerPath = join(workspaceRoot, 'skills', BUNDLED_SKILLS_MARKER);
  return existsSync(markerPath);
}

/**
 * Create a marker file to indicate bundled skills have been installed.
 */
function createBundledSkillsMarker(workspaceRoot: string, installedCount: number): void {
  const markerPath = join(workspaceRoot, 'skills', BUNDLED_SKILLS_MARKER);
  const markerContent = JSON.stringify({
    installedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    installedCount,
  }, null, 2);

  try {
    writeFileSync(markerPath, markerContent, 'utf-8');
  } catch (error) {
    log.error('[BundledSkills] Failed to create marker file:', error);
  }
}

/**
 * Check if a skill already exists in the workspace skills directory.
 * This prevents overwriting user-modified skills.
 */
function skillExists(workspaceSkillsDir: string, slug: string): boolean {
  const skillDir = join(workspaceSkillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');
  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * Copy a single skill from bundled resources to workspace skills directory.
 * Skips if the skill already exists to preserve user modifications.
 */
function copySkill(slug: string, sourcePath: string, workspaceSkillsDir: string): boolean {
  try {
    // Skip if skill already exists (preserve user modifications)
    if (skillExists(workspaceSkillsDir, slug)) {
      log.info(`[BundledSkills] Skill '${slug}' already exists, skipping`);
      return false;
    }

    const destPath = join(workspaceSkillsDir, slug);

    // Copy the entire skill directory
    cpSync(sourcePath, destPath, { recursive: true });

    log.info(`[BundledSkills] Installed skill: ${slug}`);
    return true;
  } catch (error) {
    log.error(`[BundledSkills] Failed to copy skill '${slug}':`, error);
    return false;
  }
}

/**
 * Initialize bundled skills for a workspace.
 * Copies all skills from app resources to {workspaceRoot}/skills/
 *
 * This function is called when a new workspace is created.
 * It skips skills that already exist to preserve user modifications.
 *
 * @param workspaceRoot - Absolute path to workspace root (e.g., ~/.workagent/workspaces/my-workspace)
 * @returns Number of skills installed
 */
export function initializeBundledSkills(workspaceRoot: string): number {
  try {
    const bundledSkillsPath = getBundledSkillsPath();

    // Check if bundled skills directory exists
    if (!existsSync(bundledSkillsPath)) {
      log.warn('[BundledSkills] Bundled skills directory not found:', bundledSkillsPath);
      return 0;
    }

    // Workspace skills directory: {workspaceRoot}/skills/
    const workspaceSkillsDir = join(workspaceRoot, 'skills');

    // Ensure workspace skills directory exists
    if (!existsSync(workspaceSkillsDir)) {
      mkdirSync(workspaceSkillsDir, { recursive: true });
      log.info('[BundledSkills] Created workspace skills directory:', workspaceSkillsDir);
    }

    // Read all skill directories
    const entries = readdirSync(bundledSkillsPath, { withFileTypes: true });
    const skillDirs = entries.filter(entry =>
      entry.isDirectory() && !entry.name.startsWith('.')
    );

    if (skillDirs.length === 0) {
      log.warn('[BundledSkills] No skills found in bundled directory');
      return 0;
    }

    log.info(`[BundledSkills] Found ${skillDirs.length} bundled skills, installing to workspace...`);

    let installedCount = 0;
    let skippedCount = 0;

    // Copy each skill
    for (const entry of skillDirs) {
      const sourcePath = join(bundledSkillsPath, entry.name);
      const copied = copySkill(entry.name, sourcePath, workspaceSkillsDir);

      if (copied) {
        installedCount++;
      } else {
        skippedCount++;
      }
    }

    // Create marker file to prevent re-installation
    if (installedCount > 0) {
      createBundledSkillsMarker(workspaceRoot, installedCount);
    }

    log.info(`[BundledSkills] Installation complete: ${installedCount} installed, ${skippedCount} skipped`);
    return installedCount;
  } catch (error) {
    log.error('[BundledSkills] Initialization failed:', error);
    return 0;
  }
}

/**
 * Check if a workspace needs bundled skills initialization.
 * Uses a marker file to track installation status instead of counting skills.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @returns true if bundled skills should be installed
 */
export function shouldInitializeBundledSkills(workspaceRoot: string): boolean {
  // If marker file exists, bundled skills have already been installed
  if (hasBundledSkillsMarker(workspaceRoot)) {
    return false;
  }

  const workspaceSkillsDir = join(workspaceRoot, 'skills');

  // If skills directory doesn't exist, needs initialization
  if (!existsSync(workspaceSkillsDir)) {
    return true;
  }

  // If skills directory exists but no marker, it might be:
  // 1. An old workspace created before bundled skills feature
  // 2. A workspace with user-added skills only
  // We should initialize to give users the bundled skills
  return true;
}

/**
 * Initialize bundled skills for all existing workspaces that need them.
 * This is called on app startup to ensure all workspaces have bundled skills.
 *
 * @param workspaces - Array of workspace configurations
 * @returns Number of workspaces that received bundled skills
 */
export function initializeBundledSkillsForExistingWorkspaces(
  workspaces: Array<{ id: string; rootPath: string; name: string }>
): number {
  let initializedCount = 0;

  for (const workspace of workspaces) {
    if (shouldInitializeBundledSkills(workspace.rootPath)) {
      log.info(`[BundledSkills] Initializing bundled skills for existing workspace: ${workspace.name}`);
      const installed = initializeBundledSkills(workspace.rootPath);
      if (installed > 0) {
        initializedCount++;
      }
    }
  }

  if (initializedCount > 0) {
    log.info(`[BundledSkills] Initialized bundled skills for ${initializedCount} existing workspace(s)`);
  }

  return initializedCount;
}

/**
 * Reinstall all bundled skills for a workspace.
 * This will overwrite existing skills, so use with caution.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @returns Number of skills reinstalled
 */
export function reinstallBundledSkills(workspaceRoot: string): number {
  try {
    const bundledSkillsPath = getBundledSkillsPath();

    if (!existsSync(bundledSkillsPath)) {
      log.warn('[BundledSkills] Bundled skills directory not found');
      return 0;
    }

    const workspaceSkillsDir = join(workspaceRoot, 'skills');

    // Ensure workspace skills directory exists
    if (!existsSync(workspaceSkillsDir)) {
      mkdirSync(workspaceSkillsDir, { recursive: true });
    }

    const entries = readdirSync(bundledSkillsPath, { withFileTypes: true });
    const skillDirs = entries.filter(entry =>
      entry.isDirectory() && !entry.name.startsWith('.')
    );

    let count = 0;

    for (const entry of skillDirs) {
      const sourcePath = join(bundledSkillsPath, entry.name);
      const destPath = join(workspaceSkillsDir, entry.name);

      try {
        // Remove existing skill if present
        if (existsSync(destPath)) {
          require('fs').rmSync(destPath, { recursive: true });
        }

        // Copy skill
        cpSync(sourcePath, destPath, { recursive: true });
        count++;

        log.info(`[BundledSkills] Reinstalled skill: ${entry.name}`);
      } catch (error) {
        log.error(`[BundledSkills] Failed to reinstall skill '${entry.name}':`, error);
      }
    }

    log.info(`[BundledSkills] Reinstalled ${count} skills`);
    return count;
  } catch (error) {
    log.error('[BundledSkills] Reinstall failed:', error);
    return 0;
  }
}
