/**
 * Skill Variables Substitution
 *
 * Handles {{VAR_NAME}} placeholder substitution in skill content.
 */

import type { SkillVariable } from './types.ts';

/**
 * Substitute {{VAR_NAME}} placeholders in skill content with actual values.
 *
 * @param content - Skill content with {{VAR_NAME}} placeholders
 * @param varDefinitions - Variable definitions from skill metadata
 * @param varValues - Actual variable values (from credential store)
 * @returns Content with substituted values
 *
 * Substitution rules:
 * - Set variables: replaced with actual value
 * - Unset required variables: preserved as {{VAR_NAME}} (will be flagged in UI)
 * - Unset optional variables with defaults: replaced with default value
 * - Unset optional variables without defaults: preserved as {{VAR_NAME}}
 */
export function substituteSkillVars(
  content: string,
  varDefinitions: SkillVariable[] | undefined,
  varValues: Record<string, string>
): string {
  if (!varDefinitions || varDefinitions.length === 0) {
    return content;
  }

  // Create a map of variable names to their definitions for quick lookup
  const varDefMap = new Map<string, SkillVariable>();
  for (const varDef of varDefinitions) {
    varDefMap.set(varDef.name, varDef);
  }

  // Replace all {{VAR_NAME}} placeholders
  return content.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (match, varName: string): string => {
    // Check if we have a value for this variable
    const value = varValues[varName];
    if (value !== undefined) {
      return value;
    }

    // Check if this variable is defined in metadata
    const varDef = varDefMap.get(varName);
    if (!varDef) {
      // Unknown variable - preserve placeholder
      return match;
    }

    // Variable is defined but not set
    if (!varDef.required && varDef.default !== undefined) {
      // Optional variable with default - use default
      return varDef.default;
    }

    // Required variable or optional without default - preserve placeholder
    return match;
  });
}

/**
 * Check if a skill has unset required variables.
 *
 * @param varDefinitions - Variable definitions from skill metadata
 * @param varValues - Actual variable values (from credential store)
 * @returns Array of unset required variable names
 */
export function getUnsetRequiredVars(
  varDefinitions: SkillVariable[] | undefined,
  varValues: Record<string, string>
): string[] {
  if (!varDefinitions || varDefinitions.length === 0) {
    return [];
  }

  const unset: string[] = [];

  for (const varDef of varDefinitions) {
    if (varDef.required && !(varDef.name in varValues)) {
      unset.push(varDef.name);
    }
  }

  return unset;
}

/**
 * Check if a skill content contains any {{VAR_NAME}} placeholders.
 *
 * @param content - Skill content to check
 * @returns True if content contains placeholders
 */
export function hasVarPlaceholders(content: string): boolean {
  return /\{\{[A-Z_][A-Z0-9_]*\}\}/.test(content);
}
