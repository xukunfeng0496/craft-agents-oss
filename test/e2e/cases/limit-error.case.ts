import type { E2ECase } from './types.ts';

/**
 * R-LIMIT-SILENCE — 限额(硬 429)时 UI 必须显示错误，绝不静默。
 *
 * 根因回归：SDK 对 API 失败 turn 的收尾是 result{subtype:'success', is_error:true}
 * （实测序列：assistant error 'rate_limit' → result success+is_error）。#36 的
 * 抑制修复只按 subtype 裁决 → 把限额错误当"瞬态已恢复"吞掉 → 不报错也不回消息。
 *
 * 手法：起本地恒 429 mock 网关 → 经 SETUP 建派生内置连接 anthropic-api-2
 * （数字后缀套用 anthropic-api 模板，可带自定义 baseUrl 且不触网关不变量）
 * → 设默认 → deferSetup 跳过 onboarding → 发消息 → 轮询 DOM 出现限额错误文案。
 */
export const limitErrorCase: E2ECase = {
  id: 'R-LIMIT-SILENCE',
  title: '硬限额(429) UI 显示错误而非静默(is_error=true 裁决)',
  tags: ['gateway', 'errors'],
  origin: '2026-06-27 限额静默回归(#36 抑制修复盲区) / 3a4a9aea',
  fixture: 'clean',
  async run({ cdp, evidenceDir }) {
    const quotaText = '已超出本月用量限额 (quota exceeded for this month)';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith('/v1/messages')) {
          return new Response(
            JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: quotaText } }),
            { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const setup = await cdp.eval<any>(`(async()=>{try{return await window.electronAPI.setupLlmConnection({
        slug:'anthropic-api-2', name:'Mock 429', providerType:'anthropic', authType:'api_key',
        baseUrl:${JSON.stringify(baseUrl)}, credential:'test-key-quota',
        models:['CVTE-AUTO'], defaultModel:'CVTE-AUTO'
      })}catch(e){return {threw:String(e)}}})()`);
      if (!setup?.success) return { ok: false, detail: `setup 失败: ${JSON.stringify(setup)}` };
      await cdp.eval(`(async()=>await window.electronAPI.setDefaultLlmConnection('anthropic-api-2'))()`);

      // 跳过 onboarding 遮挡并刷新主界面
      await cdp.eval(`(async()=>{try{await window.electronAPI.deferSetup?.()}catch(e){}})()`).catch(() => {});
      await cdp.eval(`location.reload()`).catch(() => {});
      for (let i = 0; i < 20; i++) {
        const ready = await cdp.eval<boolean>(`!!window.electronAPI`).catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      const wsId = await cdp.eval<string>(`(async()=>{const w=await window.electronAPI.getWorkspaces();const a=Array.isArray(w)?w:(w?.workspaces??[]);return a[0]?.id??''})()`);
      if (!wsId) return { ok: false, detail: 'workspace 未找到' };
      const sessionId = await cdp.eval<string>(`(async()=>{const s=await window.electronAPI.createSession(${JSON.stringify(wsId)},{});return s?.id??''})()`);
      if (!sessionId) return { ok: false, detail: 'createSession 失败' };
      await cdp.eval(`(async()=>await window.electronAPI.sendMessage(${JSON.stringify(sessionId)}, '你好', [], [], {}))()`);

      // SDK 会先重试(api_retry 退避)，最长等 90s
      const MARKERS = ['已超出本月用量限额', 'Rate Limit', 'API Error', 'Too many requests'];
      let hit = '';
      for (let i = 0; i < 45 && !hit; i++) {
        hit = await cdp.eval<string>(`(()=>{const t=document.body.innerText||'';for(const m of ${JSON.stringify(MARKERS)})if(t.includes(m))return m;return ''})()`).catch(() => '');
        if (!hit) await new Promise((r) => setTimeout(r, 2000));
      }

      const shot = `${evidenceDir}/R-LIMIT-SILENCE.png`;
      await cdp.screenshot(shot).catch(() => {});
      return {
        ok: !!hit,
        detail: hit ? `UI 显示限额错误(命中: "${hit}")` : '90s 内 UI 无任何错误文案(仍静默)',
        evidence: [shot],
      };
    } finally {
      server.stop(true);
    }
  },
};
