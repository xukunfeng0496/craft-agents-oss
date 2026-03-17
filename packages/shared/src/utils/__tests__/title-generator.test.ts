import { describe, expect, it } from 'bun:test';

import {
  buildFallbackRegeneratedTitle,
  buildFallbackTitle,
} from '../title-generator.ts';

describe('buildFallbackTitle', () => {
  it('extracts a concise Chinese title from the first user message', () => {
    expect(buildFallbackTitle('现在的会话生成标题，是不是功能禁用了')).toBe('会话生成标题');
  });

  it('extracts a concise English title from a request', () => {
    expect(buildFallbackTitle('Please fix the authentication bug in session title generation')).toBe(
      'fix the authentication bug in'
    );
  });
});

describe('buildFallbackRegeneratedTitle', () => {
  it('prefers informative earlier user messages over generic follow-ups', () => {
    expect(
      buildFallbackRegeneratedTitle(
        ['现在的会话生成标题，是不是功能禁用了', '可以分析下', '好像也没有生效'],
        '标题生成调用已经发出，但 provider 返回 503 no_available_providers。'
      )
    ).toBe('会话生成标题');
  });
});
