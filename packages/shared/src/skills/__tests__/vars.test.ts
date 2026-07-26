/**
 * Skill Variables Integration Test
 *
 * Tests the complete skill variables flow:
 * 1. Store variables in encrypted credential store
 * 2. Retrieve variables
 * 3. Substitute placeholders in skill content
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getSkillVar, setSkillVar, getSkillVars, setSkillVars, deleteSkillVar } from '../vars-storage.ts';
import { substituteSkillVars, getUnsetRequiredVars } from '../vars-substitution.ts';
import type { SkillVariable } from '../types.ts';

const TEST_WORKSPACE_ID = 'test-workspace';
const TEST_SKILL_SLUG = 'test-skill';

describe('Skill Variables Storage', () => {
  beforeEach(async () => {
    // Clean up test variables
    await deleteSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'TEST_VAR_1');
    await deleteSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'TEST_VAR_2');
  });

  test('should store and retrieve a single variable', async () => {
    await setSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'TEST_VAR_1', 'test-value-1');
    const value = await getSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'TEST_VAR_1');
    expect(value).toBe('test-value-1');
  });

  test('should return null for unset variable', async () => {
    const value = await getSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'NONEXISTENT');
    expect(value).toBeNull();
  });

  test('should store and retrieve multiple variables', async () => {
    await setSkillVars(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, {
      TEST_VAR_1: 'value-1',
      TEST_VAR_2: 'value-2',
    });

    const vars = await getSkillVars(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, ['TEST_VAR_1', 'TEST_VAR_2']);
    expect(vars).toEqual({
      TEST_VAR_1: 'value-1',
      TEST_VAR_2: 'value-2',
    });
  });

  test('should only return set variables', async () => {
    await setSkillVar(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, 'TEST_VAR_1', 'value-1');

    const vars = await getSkillVars(TEST_WORKSPACE_ID, TEST_SKILL_SLUG, ['TEST_VAR_1', 'TEST_VAR_2']);
    expect(vars).toEqual({
      TEST_VAR_1: 'value-1',
    });
  });
});

describe('Skill Variables Substitution', () => {
  test('should substitute set variables', () => {
    const content = 'API URL: {{API_URL}}, Key: {{API_KEY}}';
    const varDefs: SkillVariable[] = [
      { name: 'API_URL', description: 'API URL', required: true },
      { name: 'API_KEY', description: 'API Key', required: true },
    ];
    const varValues = {
      API_URL: 'https://api.example.com',
      API_KEY: 'sk-123',
    };

    const result = substituteSkillVars(content, varDefs, varValues);
    expect(result).toBe('API URL: https://api.example.com, Key: sk-123');
  });

  test('should preserve unset required variables', () => {
    const content = 'API URL: {{API_URL}}, Key: {{API_KEY}}';
    const varDefs: SkillVariable[] = [
      { name: 'API_URL', description: 'API URL', required: true },
      { name: 'API_KEY', description: 'API Key', required: true },
    ];
    const varValues = {
      API_URL: 'https://api.example.com',
    };

    const result = substituteSkillVars(content, varDefs, varValues);
    expect(result).toBe('API URL: https://api.example.com, Key: {{API_KEY}}');
  });

  test('should use default for unset optional variables', () => {
    const content = 'Environment: {{ENVIRONMENT}}';
    const varDefs: SkillVariable[] = [
      { name: 'ENVIRONMENT', description: 'Environment', required: false, default: 'production' },
    ];
    const varValues = {};

    const result = substituteSkillVars(content, varDefs, varValues);
    expect(result).toBe('Environment: production');
  });

  test('should detect unset required variables', () => {
    const varDefs: SkillVariable[] = [
      { name: 'API_URL', description: 'API URL', required: true },
      { name: 'API_KEY', description: 'API Key', required: true },
      { name: 'OPTIONAL_VAR', description: 'Optional', required: false },
    ];
    const varValues = {
      API_URL: 'https://api.example.com',
    };

    const unset = getUnsetRequiredVars(varDefs, varValues);
    expect(unset).toEqual(['API_KEY']);
  });

  test('should handle content without variables', () => {
    const content = 'No variables here';
    const result = substituteSkillVars(content, undefined, {});
    expect(result).toBe('No variables here');
  });
});
