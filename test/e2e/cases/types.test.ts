import { describe, it, expect } from 'bun:test';
import { selectCases, type E2ECase } from './types.ts';

const stub = (over: Partial<E2ECase>): E2ECase => ({
  id: 'X', title: 't', tags: [], origin: '', fixture: 'clean', needsKey: false,
  run: async () => ({ ok: true }), ...over,
});

describe('selectCases', () => {
  const cases = [
    stub({ id: 'A', tags: ['gateway'], needsKey: false }),
    stub({ id: 'B', tags: ['sso'], needsKey: false }),
    stub({ id: 'C', tags: ['gateway'], needsKey: true }),
  ];
  it('默认排除需要 key 的用例', () => {
    expect(selectCases(cases, {}).map(c => c.id)).toEqual(['A', 'B']);
  });
  it('按 tag 过滤', () => {
    expect(selectCases(cases, { tags: ['gateway'] }).map(c => c.id)).toEqual(['A']);
  });
  it('withKey=true 时纳入需 key 用例', () => {
    expect(selectCases(cases, { tags: ['gateway'], withKey: true }).map(c => c.id)).toEqual(['A', 'C']);
  });
  it('按 id 精确选', () => {
    expect(selectCases(cases, { ids: ['C'], withKey: true }).map(c => c.id)).toEqual(['C']);
  });
});
