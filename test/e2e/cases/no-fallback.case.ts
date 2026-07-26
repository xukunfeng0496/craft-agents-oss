import type { E2ECase } from './types.ts';

export const noFallbackCase: E2ECase = {
  id: 'R-NO-FALLBACK',
  title: '打包 config-defaults 无 fallbackApiKey / 无明文 sk- key',
  tags: ['security', 'config'],
  origin: '2026-06-15 R8 / 6823c10a',
  fixture: 'clean',
  async run({ cdp }) {
    const needs = await cdp.eval<any>(`(async()=>await window.electronAPI.getSetupNeeds())()`);
    // 去兜底后全新装必然 needsCredentials=true（无内置 key 可用）
    const ok = needs?.needsCredentials === true;
    return { ok, detail: `setupNeeds=${JSON.stringify(needs)}` };
  },
};
