/**
 * CVTE 网关延迟探针 — 固化基线测量，用于网关修复后的验收复测。
 *
 * 测量三类指标：
 *   1. 非流式总耗时（纯 LLM 链路）
 *   2. 流式 TTFT 与总耗时 —— TTFT ≈ 总耗时 即说明链路存在 SSE 缓冲（非真流式）
 *   3. （可选 --sdk）Claude Agent SDK 全链路耗时，差值即 Agent 侧开销
 *
 * 用法：
 *   bun scripts/latency-probe.ts --key sk-xxx
 *   bun scripts/latency-probe.ts --key sk-xxx --base http://172.30.127.201:23000   # 直连上游对比
 *   bun scripts/latency-probe.ts --key sk-xxx --models CVTE-AUTO,deepseek-v4-flash --sdk
 *
 * 基线参考（2026-06-13，问题修复前）：
 *   经 token.cvte.com：TTFT≈总耗时（全量缓冲）；deepseek TTFT 3.1s
 *   直连上游 23000：  deepseek TTFT 0.90s/总 2.62s（真流式）→ 网关加 ~2.2s 且杀流式
 */

interface Args {
  base: string;
  key: string;
  models: string[];
  sdk: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const key = get('--key') ?? process.env.GW_KEY ?? '';
  if (!key) {
    console.error('用法: bun scripts/latency-probe.ts --key <api-key> [--base <url>] [--models a,b] [--sdk]');
    process.exit(2);
  }
  return {
    base: (get('--base') ?? 'https://token.cvte.com').replace(/\/+$/, ''),
    key,
    models: (get('--models') ?? 'CVTE-AUTO,deepseek-v4-flash').split(',').map((s) => s.trim()).filter(Boolean),
    sdk: argv.includes('--sdk'),
  };
}

async function probeModel(base: string, key: string, model: string) {
  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const body = (stream: boolean) => JSON.stringify({
    model,
    max_tokens: 128,
    stream,
    messages: [{ role: 'user', content: '数1到10' }],
  });

  // 非流式总耗时
  const t0 = performance.now();
  const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: body(false) });
  await res.text();
  const nonStreamTotal = (performance.now() - t0) / 1000;
  if (!res.ok) {
    console.log(`  ${model}: ❌ HTTP ${res.status}（key 无效或模型不可用）`);
    return;
  }

  // 流式 TTFT / 总耗时 / 块数
  const t1 = performance.now();
  const streamRes = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: body(true) });
  const reader = streamRes.body!.getReader();
  let ttft = 0;
  let chunks = 0;
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
    chunks++;
    if (!ttft) ttft = (performance.now() - t1) / 1000;
  }
  const streamTotal = (performance.now() - t1) / 1000;

  const buffered = streamTotal - ttft < 0.2 && chunks <= 2;
  console.log(
    `  ${model}: 非流式 ${nonStreamTotal.toFixed(2)}s | 流式 TTFT ${ttft.toFixed(2)}s / 总 ${streamTotal.toFixed(2)}s / ${chunks} 块 → ${buffered ? '❌ 疑似全量缓冲（非真流式）' : '✅ 真流式'}`,
  );
}

async function probeSdk(base: string, key: string, model: string) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.ANTHROPIC_API_KEY = key;
  const t0 = performance.now();
  let tFirst = 0;
  const q = query({
    prompt: '用一句话介绍你自己',
    options: { model, cwd: '/tmp/latency-probe', permissionMode: 'bypassPermissions', maxTurns: 1 },
  });
  for await (const m of q as AsyncIterable<{ type: string }>) {
    if (!tFirst && (m.type === 'stream_event' || m.type === 'assistant')) tFirst = performance.now();
  }
  const total = (performance.now() - t0) / 1000;
  console.log(`  SDK 全链路（${model}）: 首内容 ${((tFirst - t0) / 1000).toFixed(2)}s | 总 ${total.toFixed(2)}s（与纯 LLM 的差值≈Agent 侧开销）`);
}

export {};

const args = parseArgs();
console.log(`目标: ${args.base} | 模型: ${args.models.join(', ')}\n`);
for (const model of args.models) {
  await probeModel(args.base, args.key, model);
}
if (args.sdk) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync('/tmp/latency-probe', { recursive: true });
  await probeSdk(args.base, args.key, args.models[0]!);
}
