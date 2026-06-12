/**
 * Skill Variables Storage
 *
 * Manages skill variable values using the encrypted credential store.
 * Variables are stored as: skill_var::{workspaceId}::{skillSlug}::{varName}
 */

import { getCredentialManager } from '../credentials/index.ts';
import type { CredentialId } from '../credentials/types.ts';

/**
 * Get a single skill variable value
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param varName - Variable name
 * @returns Variable value or null if not set
 */
export async function getSkillVar(
  workspaceId: string,
  skillSlug: string,
  varName: string
): Promise<string | null> {
  const credentialId: CredentialId = {
    type: 'skill_var',
    workspaceId,
    skillSlug,
    varName,
  };

  const manager = getCredentialManager();
  const credential = await manager.get(credentialId);

  return credential?.value ?? null;
}

/**
 * Get all skill variable values for a skill
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param varNames - Array of variable names to fetch
 * @returns Record of variable name to value (only includes set variables)
 */
export async function getSkillVars(
  workspaceId: string,
  skillSlug: string,
  varNames: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const varName of varNames) {
    const value = await getSkillVar(workspaceId, skillSlug, varName);
    if (value !== null) {
      result[varName] = value;
    }
  }

  return result;
}

/**
 * Set a single skill variable value
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param varName - Variable name
 * @param value - Variable value
 */
export async function setSkillVar(
  workspaceId: string,
  skillSlug: string,
  varName: string,
  value: string
): Promise<void> {
  const credentialId: CredentialId = {
    type: 'skill_var',
    workspaceId,
    skillSlug,
    varName,
  };

  const manager = getCredentialManager();
  await manager.set(credentialId, { value });
}

/**
 * Set multiple skill variable values for a skill
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param vars - Record of variable name to value
 */
export async function setSkillVars(
  workspaceId: string,
  skillSlug: string,
  vars: Record<string, string>
): Promise<void> {
  for (const [varName, value] of Object.entries(vars)) {
    await setSkillVar(workspaceId, skillSlug, varName, value);
  }
}

/**
 * Delete a single skill variable
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param varName - Variable name
 */
export async function deleteSkillVar(
  workspaceId: string,
  skillSlug: string,
  varName: string
): Promise<void> {
  const credentialId: CredentialId = {
    type: 'skill_var',
    workspaceId,
    skillSlug,
    varName,
  };

  const manager = getCredentialManager();
  await manager.delete(credentialId);
}

/**
 * Delete all skill variables for a skill
 * @param workspaceId - Workspace ID
 * @param skillSlug - Skill slug
 * @param varNames - Array of variable names to delete
 */
export async function deleteSkillVars(
  workspaceId: string,
  skillSlug: string,
  varNames: string[]
): Promise<void> {
  for (const varName of varNames) {
    await deleteSkillVar(workspaceId, skillSlug, varName);
  }
}
