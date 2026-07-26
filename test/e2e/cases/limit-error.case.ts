import type { E2ECase } from './types.ts';

/**
 * R-LIMIT-SILENCE — 限额(硬 429)时 UI 必须显示错误，绝不静默。
 *
 * 根因回归：SDK 对 API 失败 turn 的收尾是 result{subtype:'success', is_error:true}
 * （实测序列：assistant error 'rate_limit' → result success+is_error）。#36 的
 * 抑制修复只按 subtype 裁决 → 把限额错误当"瞬态已恢复"吞掉 → 不报错也不回消息。
 * 裁决点在 event-adapter.ts 的 `msg.subtype !== 'success' || msg.is_error === true`，
 * **只在 Claude Agent SDK 路线上执行**（providerType 'anthropic'）。
 *
 * 手法（必须落到 Claude SDK 路线，否则用例是空跑）：
 *   1. 起本地恒 429 mock 网关（带命中计数）。
 *   2. SETUP 建派生内置连接 anthropic-api-2（数字后缀套 anthropic-api 模板）。
 *      注意：SETUP 见到自定义 baseUrl 且非企业网关host时，会把连接降到
 *      pi_compat + customEndpoint{anthropic-messages} → 走 Pi 子进程，**不经过**
 *      event-adapter 的 is_error 裁决，mock 也收不到请求（旧版用例的盲区）。
 *   3. 所以紧接着用 SAVE 把它掰回 Anthropic 形态（customEndpoint 传 null 才能清掉
 *      —— updateLlmConnection 把 undefined 当"保持原值"）。127.0.0.1 既不是企业
 *      网关 host 也不是网关 slug，D8 不变量不会来改它。
 *   4. 断言形态确实是 anthropic，再发消息、轮询 DOM。
 *   5. 收尾报告 mock 命中数——0 命中说明路线又漂了，用例失效而非产品静默。
 *
 * 观测窗（2026-07-27 实测，勿随意调小）：恒 429 下 SDK 要把 10 次指数退避重试跑完
 * 才收尾，实测 **184s** 才出终局错误卡（mock 被打 42 次）。退避期间 UI 一直显示
 * `API error 429, retrying (n/10)...`。90s 窗口会把「还在重试」误判成「静默」——
 * 这正是上一版用例的假阳性来源。
 * 终局文案实测为 `Rate Limit Exceeded: Too many requests...`（英文，非中文 quota 原文）。
 */
export const limitErrorCase: E2ECase = {
  id: 'R-LIMIT-SILENCE',
  title: '硬限额(429) UI 显示错误而非静默(is_error=true 裁决)',
  tags: ['gateway', 'errors'],
  origin: '2026-06-27 限额静默回归(#36 抑制修复盲区) / 3a4a9aea',
  fixture: 'clean',
  async run({ cdp, evidenceDir }) {
    const quotaText = '已超出本月用量限额 (quota exceeded for this month)';
    let messagesHits = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith('/v1/messages')) {
          messagesHits++;
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

      // 掰回 Claude Agent SDK 路线（customEndpoint 必须显式传 null 才清得掉）
      const saved = await cdp.eval<any>(`(async()=>{try{return await window.electronAPI.saveLlmConnection({
        slug:'anthropic-api-2', name:'Mock 429',
        providerType:'anthropic', authType:'api_key', customEndpoint:null,
        baseUrl:${JSON.stringify(baseUrl)}, models:['CVTE-AUTO'], defaultModel:'CVTE-AUTO'
      })}catch(e){return {threw:String(e)}}})()`);
      if (!saved?.success) return { ok: false, detail: `save 失败: ${JSON.stringify(saved)}` };

      // 路线自检：形态不对就直接判失败并说清楚，绝不让用例静悄悄空跑
      const conn = await cdp.eval<any>(`(async()=>await window.electronAPI.getLlmConnection('anthropic-api-2'))()`);
      if (conn?.providerType !== 'anthropic' || conn?.baseUrl !== baseUrl) {
        return { ok: false, detail: `连接未落在 Claude SDK 路线(用例失效): ${JSON.stringify({ providerType: conn?.providerType, authType: conn?.authType, baseUrl: conn?.baseUrl, customEndpoint: conn?.customEndpoint })}` };
      }
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

      // 终局裁决文案（SDK 重试耗尽后的错误卡）。实测 184s，窗口给到 300s。
      const TERMINAL = ['Rate Limit Exceeded', '已超出本月用量限额', 'Too many requests', 'rate_limit'];
      // 退避期的过程反馈：`API error 429, retrying (n/10)...`（注意是小写 error，正则内联在 eval 里）
      let hit = '';
      let sawRetrying = false;
      let elapsed = 0;
      for (let i = 0; i < 150 && !hit; i++) {
        const probe = await cdp
          .eval<{ hit: string; retrying: boolean }>(
            `(()=>{const t=document.body.innerText||'';return {hit:${JSON.stringify(TERMINAL)}.find(m=>t.includes(m))||'',retrying:/api error \\d+, retrying/i.test(t)}})()`,
          )
          .catch(() => ({ hit: '', retrying: false }));
        hit = probe?.hit || '';
        if (probe?.retrying) sawRetrying = true;
        if (!hit) {
          await new Promise((r) => setTimeout(r, 2000));
          elapsed += 2;
        }
      }

      const shot = `${evidenceDir}/R-LIMIT-SILENCE.png`;
      await cdp.screenshot(shot).catch(() => {});
      const retryNote = sawRetrying ? '，退避期有 retrying 提示' : '，退避期无过程提示';
      return {
        ok: !!hit && messagesHits > 0,
        detail: hit
          ? `UI 显示限额错误(终局命中 "${hit}"，用时 ${elapsed}s，mock /v1/messages 被请求 ${messagesHits} 次${retryNote})`
          : messagesHits === 0
            ? '300s 内 mock 一次都没被请求 —— 请求没走到 Claude SDK 路线，用例失效'
            : `300s 内 UI 无终局错误文案(仍静默)；mock 已被请求 ${messagesHits} 次${retryNote}`,
        evidence: [shot],
      };
    } finally {
      server.stop(true);
    }
  },
};
