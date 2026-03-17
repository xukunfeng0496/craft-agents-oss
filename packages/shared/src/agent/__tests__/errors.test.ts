import { describe, expect, it } from 'bun:test';
import { parseError } from '../errors.ts';

describe('parseError', () => {
  it('classifies SIGABRT process exits as runtime crashes', () => {
    const parsed = parseError(new Error('Claude Code process terminated by signal SIGABRT'));

    expect(parsed.code).toBe('runtime_crash');
    expect(parsed.title).toBe('Claude Runtime Crashed');
    expect(parsed.canRetry).toBe(true);
  });
});
