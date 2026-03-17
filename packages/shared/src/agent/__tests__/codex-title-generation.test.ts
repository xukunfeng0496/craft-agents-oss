import { describe, expect, it } from 'bun:test';

import { CodexAgent } from '../codex-agent.ts';
import { buildTitlePrompt } from '../../utils/title-generator.ts';

describe('CodexAgent.generateTitle', () => {
  it('builds the shared title prompt from the raw user message', async () => {
    const agent = Object.create(CodexAgent.prototype) as CodexAgent & {
      capturedPrompt?: string;
      runMiniCompletion(prompt: string): Promise<string | null>;
    };

    agent.runMiniCompletion = async (prompt: string) => {
      agent.capturedPrompt = prompt;
      return '修复标题生成';
    };

    const message = '会话标题没有自动更新，帮我排查一下';
    const language = 'zh-CN';

    const title = await agent.generateTitle(message, language);

    expect(agent.capturedPrompt).toBe(buildTitlePrompt(message, language));
    expect(title).toBe('修复标题生成');
  });
});
