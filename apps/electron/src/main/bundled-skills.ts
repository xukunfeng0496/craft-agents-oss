/**
 * Bundled Skills Initialization
 *
 * Copies pre-installed skills from app resources to global skills directory
 * on first launch. This ensures users have a set of default skills available
 * without manual installation.
 */

import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import log from './logger';

/** Global agent skills directory: ~/.workagent/skills/ */
const GLOBAL_SKILLS_DIR = join(homedir(), '.workagent', 'skills');

/** Marker file to track if bundled skills have been installed */
const INSTALLED_MARKER = join(GLOBAL_SKILLS_DIR, '.bundled-skills-installed');

/**
 * Get the path to bundled skills in the app resources.
 * Handles both development and production environments.
 */
function getBundledSkillsPath(): string {
  if (app.isPackaged) {
    // Production: resources are in app.asar or app directory
    return join(process.resourcesPath, 'app', 'resources', 'bundled-skills');
  } else {
    // Development: resources are in the source tree
    return join(app.getAppPath(), 'resources', 'bundled-skills');
  }
}

/**
 * Check if a skill already exists in the global skills directory.
 * This prevents overwriting user-modified skills.
 */
function skillExists(slug: string): boolean {
  const skillDir = join(GLOBAL_SKILLS_DIR, slug);
  const skillFile = join(skillDir, 'SKILL.md');
  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * Copy a single skill from bundled resources to global skills directory.
 * Skips if the skill already exists to preserve user modifications.
 */
function copySkill(slug: string, sourcePath: string): boolean {
  try {
    // Skip if skill already exists (preserve user modifications)
    if (skillExists(slug)) {
      log.info(`[BundledSkills] Skill '${slug}' already exists, skipping`);
      return false;
    }

    const destPath = join(GLOBAL_SKILLS_DIR, slug);

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
 * Initialize bundled skills on first launch.
 * Copies all skills from app resources to ~/.workagent/skills/
 *
 * This function is idempotent - it only runs once per installation.
 * If skills are already installed, it skips the process.
 */
export function initializeBundledSkills(): void {
  try {
    // Check if bundled skills have already been installed
    if (existsSync(INSTALLED_MARKER)) {
      log.info('[BundledSkills] Already initialized, skipping');
      return;
    }

    const bundledSkillsPath = getBundledSkillsPath();

    // Check if bundled skills directory exists
    if (!existsSync(bundledSkillsPath)) {
      log.warn('[BundledSkills] Bundled skills directory not found:', bundledSkillsPath);
      return;
    }

    // Ensure global skills directory exists
    if (!existsSync(GLOBAL_SKILLS_DIR)) {
      mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
      log.info('[BundledSkills] Created global skills directory:', GLOBAL_SKILLS_DIR);
    }

    // Read all skill directories
    const entries = readdirSync(bundledSkillsPath, { withFileTypes: true });
    const skillDirs = entries.filter(entry => entry.isDirectory());

    if (skillDirs.length === 0) {
      log.warn('[BundledSkills] No skills found in bundled directory');
      return;
    }

    log.info(`[BundledSkills] Found ${skillDirs.length} bundled skills, installing...`);

    let installedCount = 0;
    let skippedCount = 0;

    // Copy each skill
    for (const entry of skillDirs) {
      const sourcePath = join(bundledSkillsPath, entry.name);
      const copied = copySkill(entry.name, sourcePath);

      if (copied) {
        installedCount++;
      } else {
        skippedCount++;
      }
    }

    // Create marker file to indicate installation is complete
    try {
      const markerContent = JSON.stringify({
        installedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        installedCount,
        skippedCount,
      }, null, 2);

      require('fs').writeFileSync(INSTALLED_MARKER, markerContent, 'utf-8');

      log.info(`[BundledSkills] Installation complete: ${installedCount} installed, ${skippedCount} skipped`);
    } catch (error) {
      log.error('[BundledSkills] Failed to create marker file:', error);
    }
  } catch (error) {
    log.error('[BundledSkills] Initialization failed:', error);
  }
}

/**
 * Force reinstall all bundled skills.
 * This will overwrite existing skills, so use with caution.
 *
 * @returns Number of skills reinstalled
 */
export function reinstallBundledSkills(): number {
  try {
    const bundledSkillsPath = getBundledSkillsPath();

    if (!existsSync(bundledSkillsPath)) {
      log.warn('[BundledSkills] Bundled skills directory not found');
      return 0;
    }

    // Ensure global skills directory exists
    if (!existsSync(GLOBAL_SKILLS_DIR)) {
      mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
    }

    const entries = readdirSync(bundledSkillsPath, { withFileTypes: true });
    const skillDirs = entries.filter(entry => entry.isDirectory());

    let count = 0;

    for (const entry of skillDirs) {
      const sourcePath = join(bundledSkillsPath, entry.name);
      const destPath = join(GLOBAL_SKILLS_DIR, entry.name);

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

    // Update marker file
    if (existsSync(INSTALLED_MARKER)) {
      require('fs').unlinkSync(INSTALLED_MARKER);
    }

    const markerContent = JSON.stringify({
      installedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      reinstalled: true,
      count,
    }, null, 2);

    require('fs').writeFileSync(INSTALLED_MARKER, markerContent, 'utf-8');

    log.info(`[BundledSkills] Reinstalled ${count} skills`);
    return count;
  } catch (error) {
    log.error('[BundledSkills] Reinstall failed:', error);
    return 0;
  }
}
