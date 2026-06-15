import type { E2ECase } from './types.ts';

export const provisionCase: E2ECase = {
  id: 'R-PROVISION',
  title: '全新装零配置 provision 出 cvte-gateway / anthropic / CVTE-AUTO',
  tags: ['provision', 'onboarding'],
  origin: 'rebaseline C1',
  fixture: 'clean',
  async run({ cdp }) {
    const conns = await cdp.eval<any[]>(`(async()=>{const c=await window.electronAPI.listLlmConnectionsWithStatus();return c.map(x=>({slug:x.slug,pt:x.providerType,model:x.defaultModel}))})()`);
    const gw = conns.find((c) => c.slug === 'cvte-gateway');
    const ok = !!gw && gw.pt === 'anthropic' && gw.model === 'CVTE-AUTO';
    return { ok, detail: ok ? 'cvte-gateway anthropic CVTE-AUTO' : `got ${JSON.stringify(conns)}` };
  },
};
