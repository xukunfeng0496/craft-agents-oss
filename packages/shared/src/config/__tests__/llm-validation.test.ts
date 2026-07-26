/**
 * Tests for the connection-validation error classifier.
 *
 * Root cause (2026-06-15): the CVTE gateway's smart-routed (non-Claude) models
 * emit `stop_reason: tool_use` even for trivial health-check prompts. The
 * Claude Agent SDK health check runs with maxTurns:1, so a tool_use turn it
 * can't follow up on throws "Reached maximum number of turns (1)". That outcome
 * still PROVES connectivity + auth + model access (the request reached the model
 * and it responded), so the validator must treat it as success, not failure.
 */
import { describe, it, expect } from 'bun:test';
import { isMaxTurnsOutcome, parseValidationError } from '../llm-validation.ts';

describe('isMaxTurnsOutcome', () => {
  it('treats the real SDK max-turns error (with R4 stderr suffix) as connectivity-proven', () => {
    expect(
      isMaxTurnsOutcome(
        'Claude Code returned an error result: Reached maximum number of turns (1) (subprocess produced no stderr output)',
      ),
    ).toBe(true);
  });

  it('matches generic max-turns phrasings and the SDK subtype', () => {
    expect(isMaxTurnsOutcome('error_max_turns')).toBe(true);
    expect(isMaxTurnsOutcome('Maximum number of turns reached')).toBe(true);
    expect(isMaxTurnsOutcome('result.subtype=error_max_turns is_error=true')).toBe(true);
  });

  it('does NOT treat real connection/auth/model failures as max-turns', () => {
    expect(isMaxTurnsOutcome('401 Unauthorized')).toBe(false);
    expect(isMaxTurnsOutcome('fetch failed')).toBe(false);
    expect(isMaxTurnsOutcome('model not found')).toBe(false);
    expect(isMaxTurnsOutcome('ECONNREFUSED')).toBe(false);
  });
});

describe('parseValidationError (unchanged contract)', () => {
  it('still maps auth errors', () => {
    expect(parseValidationError('401 unauthorized')).toMatch(/Authentication failed/);
  });
  it('still maps connection errors', () => {
    expect(parseValidationError('fetch failed')).toMatch(/Cannot connect/);
  });
});
