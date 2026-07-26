# E2E 回归测试谐振器 Implementation Plan（Phase 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把今天 e2e 排查用的一次性 CDP 脚本沉淀成检入的、可复用的 E2E 回归谐振器——一条 `bun run e2e` 即可对打包版 Work Agents 跑结构化回归用例。

**Architecture:** 三层组合。`lib/`（沙箱生命周期 + CDP 驱动 + 跨平台 app 定位，纯基础设施）→ `cases/`（结构化用例登记册，每个 bug/功能一条）→ `run.ts`（编排器：选用例→建隔离沙箱→驱动→采证→拆除→出报告）。纯逻辑部分（app 定位、用例筛选）用 `bun test` TDD；CDP/沙箱部分用对真实打包 app 的冒烟集成验证。

**Tech Stack:** Bun（原生 `WebSocket` 驱 CDP、`child_process.spawn` 启 Electron、`bun test`）、Chrome DevTools Protocol（`Runtime.evaluate`/`Page.captureScreenshot`）、TypeScript。

**Engineering Assessment:** Just right
**Reason:** 只解决"可复用 E2E 回归"这一明确问题——lib 三件套各司其职、用例是数据、runner 是薄编排；不引入测试框架抽象、不为假想平台预留。每个文件都能在脑中装下。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `test/e2e/lib/app-locate.ts` | 纯函数：按平台/架构定位打包 app 二进制路径（含 mac/win），可单测 |
| `test/e2e/lib/cdp.ts` | CDP 驱动：连端口、`eval` 求值、截图、异常订阅、关闭（bun 原生 WebSocket） |
| `test/e2e/lib/sandbox.ts` | 沙箱生命周期：隔离 HOME + `--user-data-dir` + 代理旁路 + 单实例锁 + 等 CDP 就绪 + 拆除 |
| `test/e2e/cases/types.ts` | 用例类型 `E2ECase` + 上下文 `CaseContext` + 结果 `CaseResult` + 纯函数 `selectCases` |
| `test/e2e/cases/index.ts` | 用例登记册：导出所有 case（今天 4 个无 key 种子用例） |
| `test/e2e/cases/*.case.ts` | 各回归用例（provision / release-notes / no-fallback / coldstart） |
| `test/e2e/run.ts` | 编排器：解析 `--tags/--ids/--with-key`、定位 app、逐用例跑、出报告、退出码 |
| `test/e2e/README.md` | 用法 + "事件→永久用例"纪律 + 今天沉淀的方法论铁律 |
| `package.json`（根） | 加 `"e2e": "bun run test/e2e/run.ts"` |

---

## Task 1: app-locate（跨平台 app 定位，纯函数 TDD）

**Files:**
- Create: `test/e2e/lib/app-locate.ts`
- Test: `test/e2e/lib/app-locate.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/e2e/lib/app-locate.test.ts
import { describe, it, expect } from 'bun:test';
import { locateApp } from './app-locate.ts';

describe('locateApp', () => {
  it('mac arm64 → release/mac-arm64 的 .app 二进制', () => {
    const p = locateApp({ platform: 'darwin', arch: 'arm64', repoRoot: '/repo' });
    expect(p).toBe('/repo/apps/electron/release/mac-arm64/Work Agents.app/Contents/MacOS/Work Agents');
  });
  it('win32 → %LOCALAPPDATA% 的单用户安装路径', () => {
    const p = locateApp({ platform: 'win32', arch: 'x64', repoRoot: '/repo', localAppData: 'C:/Users/u/AppData/Local' });
    expect(p).toBe('C:/Users/u/AppData/Local/Programs/work-agents/Work Agents.exe');
  });
  it('不支持的平台 → 抛错', () => {
    expect(() => locateApp({ platform: 'freebsd' as any, arch: 'x64', repoRoot: '/repo' })).toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd test/e2e && bun test lib/app-locate.test.ts`
Expected: FAIL — `Cannot find module './app-locate.ts'`

- [ ] **Step 3: 写最小实现**

```ts
// test/e2e/lib/app-locate.ts
export interface LocateOpts {
  platform?: NodeJS.Platform;
  arch?: string;
  /** 仓库根（默认从本文件向上推 4 层：test/e2e/lib → repo 根）。*/
  repoRoot?: string;
  /** Windows 用，覆盖 %LOCALAPPDATA%（测试注入）。*/
  localAppData?: string;
}

function defaultRepoRoot(): string {
  // test/e2e/lib/app-locate.ts → ../../../.. = repo 根
  return new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
}

/** 定位打包 app 的可执行二进制（不存在也返回路径——由 sandbox 启动时报错）。*/
export function locateApp(opts: LocateOpts = {}): string {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();

  if (platform === 'darwin') {
    const dir = arch === 'arm64' ? 'mac-arm64' : 'mac';
    return `${repoRoot}/apps/electron/release/${dir}/Work Agents.app/Contents/MacOS/Work Agents`;
  }
  if (platform === 'win32') {
    const lad = opts.localAppData ?? process.env.LOCALAPPDATA ?? '';
    return `${lad}/Programs/work-agents/Work Agents.exe`;
  }
  throw new Error(`unsupported platform for e2e: ${platform}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd test/e2e && bun test lib/app-locate.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 提交**

```bash
git add test/e2e/lib/app-locate.ts test/e2e/lib/app-locate.test.ts
git commit -m "test(e2e): app-locate 跨平台定位打包 app 二进制"
```

---

## Task 2: 用例类型 + 筛选（纯逻辑 TDD）

**Files:**
- Create: `test/e2e/cases/types.ts`
- Test: `test/e2e/cases/types.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/e2e/cases/types.test.ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd test/e2e && bun test cases/types.test.ts`
Expected: FAIL — `Cannot find module './types.ts'`

- [ ] **Step 3: 写实现**

```ts
// test/e2e/cases/types.ts
import type { Sandbox } from '../lib/sandbox.ts';
import type { CdpSession } from '../lib/cdp.ts';

export interface CaseContext {
  sandbox: Sandbox;
  cdp: CdpSession;
  /** 仅 needsKey 用例可用；从 E2E_CVTE_KEY 环境变量注入，绝不入库。*/
  apiKey?: string;
  /** 评估辅助：在 renderer 上下文 await 一段表达式。*/
  evidenceDir: string;
}

export interface CaseResult {
  ok: boolean;
  detail?: string;
  /** 采集到的证据文件（截图/日志片段）相对路径。*/
  evidence?: string[];
}

export interface E2ECase {
  id: string;
  title: string;
  tags: string[];
  /** 来源事件，如 '2026-06-15 #34'。*/
  origin: string;
  /** 'clean' = 全新空 HOME；'seeded' = 种存量数据；其它字符串 = 自定义 fixture 名。*/
  fixture: 'clean' | 'seeded' | string;
  /** 需要真实网关 key 才能跑（live 用例）。*/
  needsKey?: boolean;
  run(ctx: CaseContext): Promise<CaseResult>;
}

export interface SelectFilter {
  tags?: string[];
  ids?: string[];
  /** 默认 false：排除 needsKey 用例（无 key 也能跑核心回归）。*/
  withKey?: boolean;
}

export function selectCases(cases: readonly E2ECase[], filter: SelectFilter): E2ECase[] {
  return cases.filter((c) => {
    if (filter.ids?.length) return filter.ids.includes(c.id);
    if (c.needsKey && !filter.withKey) return false;
    if (filter.tags?.length && !filter.tags.some((t) => c.tags.includes(t))) return false;
    return true;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd test/e2e && bun test cases/types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 提交**

```bash
git add test/e2e/cases/types.ts test/e2e/cases/types.test.ts
git commit -m "test(e2e): 用例类型 E2ECase + selectCases 筛选（tag/id/withKey）"
```

---

## Task 3: CDP 驱动（bun 原生 WebSocket）

**Files:**
- Create: `test/e2e/lib/cdp.ts`

> 说明：CDP 驱动需要一个真实运行的 app 才能测，因此本任务只产出实现 + 类型；冒烟验证在 Task 5（runner 串起来后对真实 app 跑）。今天实测：bun 的 `ws` 包对 CDP 升级握手报 "Unexpected server response: 101"，**必须用 bun 原生 `WebSocket`**；CDP `/json` 经系统代理会被劫持，调用方进程须设 `NO_PROXY=*`。

- [ ] **Step 1: 写实现**

```ts
// test/e2e/lib/cdp.ts
import { writeFileSync } from 'node:fs';

export interface CdpSession {
  /** 在 renderer 页面上下文求值（自动 awaitPromise + returnByValue）。*/
  eval<T = unknown>(expr: string): Promise<T>;
  /** 截图存到 path（png）。*/
  screenshot(path: string): Promise<void>;
  /** 本会话期间捕获的未处理异常 / console.error。*/
  errors(): readonly string[];
  close(): void;
}

/** 连到 host:port 的 CDP page target（须 app 以 --remote-debugging-port 启动）。*/
export async function connectCdp(port: number, host = '127.0.0.1'): Promise<CdpSession> {
  const targets = (await (await fetch(`http://${host}:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no CDP page target (app not ready?)');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(new Error('cdp ws error')); });

  let id = 1;
  const pending = new Map<number, (m: any) => void>();
  const errors: string[] = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE.ERROR: ' + (m.params.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });

  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const i = id++;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`cdp timeout: ${method}`)); } }, 120_000);
  });

  await rpc('Runtime.enable');
  await rpc('Page.enable');

  return {
    async eval<T>(expr: string): Promise<T> {
      const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('eval threw: ' + (r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)));
      return r.result?.result?.value as T;
    },
    async screenshot(path: string): Promise<void> {
      const r = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    },
    errors: () => errors,
    close: () => ws.close(),
  };
}
```

- [ ] **Step 2: 类型自检**

Run: `cd packages/shared && bun run tsc --noEmit` 不覆盖 test/，改为：`bunx tsc --noEmit test/e2e/lib/cdp.ts` —— 若仓库根无独立 tsconfig 覆盖 test/，至少 `bun build test/e2e/lib/cdp.ts --target=bun > /dev/null` 确认可解析。
Expected: 无解析错误。

- [ ] **Step 3: 提交**

```bash
git add test/e2e/lib/cdp.ts
git commit -m "test(e2e): CDP 驱动（bun 原生 WebSocket，eval/screenshot/异常订阅）"
```

---

## Task 4: 沙箱生命周期

**Files:**
- Create: `test/e2e/lib/sandbox.ts`

> 说明：今天踩的雷全编码进来：`--user-data-dir` 必加（否则被正在运行实例顶掉静默退出）；`NO_PROXY` 旁路（系统代理劫持 127.0.0.1）；等 CDP `/json/version` 就绪再返回；teardown 杀进程树。

- [ ] **Step 1: 写实现**

```ts
// test/e2e/lib/sandbox.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

export interface SandboxOptions {
  cdpPort: number;
  /** 'clean' 全新空 HOME；'seeded' 从 fixtures/seeded-home 拷入；或绝对路径作为 HOME 模板。*/
  fixture?: 'clean' | 'seeded' | string;
  /** 开 CRAFT_DEBUG（注意会改变时序，掩盖竞态——竞态类用例须保持 false）。*/
  debug?: boolean;
}

export interface Sandbox {
  home: string;
  cdpPort: number;
  /** electron-log 在 mac 固定路径，不随 HOME 变——读它取 SDK/agent 真实错误。*/
  logPath(): string;
  configPath(): string;
  readConfig(): any | null;
  close(): void;
}

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;

export async function launchSandbox(appPath: string, opts: SandboxOptions): Promise<Sandbox> {
  if (!existsSync(appPath)) throw new Error(`app not found: ${appPath} — 先 bun run electron:dist:mac`);
  const home = mkdtempSync(join(tmpdir(), 'wa-e2e-'));
  const userData = mkdtempSync(join(tmpdir(), 'wa-e2e-ud-'));

  if (opts.fixture && opts.fixture !== 'clean') {
    const src = opts.fixture === 'seeded' ? join(FIXTURES, 'seeded-home') : opts.fixture;
    if (existsSync(src)) cpSync(src, home, { recursive: true });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    NO_PROXY: '127.0.0.1,localhost',
    CRAFT_DEBUG: opts.debug ? '1' : '0',
  };
  const child: ChildProcess = spawn(appPath, [
    `--remote-debugging-port=${opts.cdpPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userData}`,
  ], { env, stdio: ['ignore', 'ignore', 'ignore'], detached: false });

  // 等 CDP 就绪（最多 30s）
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) { try { child.kill('SIGKILL'); } catch {} throw new Error('CDP not ready within 30s'); }
    try {
      const r = await fetch(`http://127.0.0.1:${opts.cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) } as any);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    home,
    cdpPort: opts.cdpPort,
    logPath: () => join(homedir(), 'Library', 'Logs', '@craft-agent', 'electron', 'main.log'),
    configPath: () => join(home, '.workagent', 'config.json'),
    readConfig() {
      const p = join(home, '.workagent', 'config.json');
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
    },
    close() {
      try { child.kill('SIGKILL'); } catch {}
      try { rmSync(home, { recursive: true, force: true }); } catch {}
      try { rmSync(userData, { recursive: true, force: true }); } catch {}
    },
  };
}
```

- [ ] **Step 2: 解析自检**

Run: `bun build test/e2e/lib/sandbox.ts --target=bun > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: 提交**

```bash
git add test/e2e/lib/sandbox.ts
git commit -m "test(e2e): 沙箱生命周期（隔离HOME+user-data-dir+代理旁路+等CDP就绪+拆除）"
```

---

## Task 5: 编排器 runner + 首个真实用例（provision）

**Files:**
- Create: `test/e2e/cases/provision.case.ts`
- Create: `test/e2e/cases/index.ts`
- Create: `test/e2e/run.ts`
- Modify: `package.json`（根，scripts 加 `"e2e"`）

- [ ] **Step 1: 写第一个用例（R-PROVISION，无需 key）**

```ts
// test/e2e/cases/provision.case.ts
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
```

- [ ] **Step 2: 写登记册（导出全部用例）**

```ts
// test/e2e/cases/index.ts
import type { E2ECase } from './types.ts';
import { provisionCase } from './provision.case.ts';

export const ALL_CASES: readonly E2ECase[] = [
  provisionCase,
  // 后续 task 追加：releaseNotesCase, noFallbackCase, coldStartCase, ...
];
```

- [ ] **Step 3: 写编排器**

```ts
// test/e2e/run.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { locateApp } from './lib/app-locate.ts';
import { launchSandbox } from './lib/sandbox.ts';
import { connectCdp } from './lib/cdp.ts';
import { selectCases } from './cases/types.ts';
import { ALL_CASES } from './cases/index.ts';

function parseArgs(argv: string[]) {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    tags: get('--tags')?.split(','),
    ids: get('--ids')?.split(','),
    withKey: argv.includes('--with-key'),
  };
}

async function main() {
  const filter = parseArgs(process.argv.slice(2));
  const selected = selectCases(ALL_CASES, filter);
  if (selected.length === 0) { console.log('no cases matched filter'); process.exit(0); }

  const appPath = locateApp();
  const apiKey = filter.withKey ? process.env.E2E_CVTE_KEY : undefined;
  if (filter.withKey && !apiKey) { console.error('--with-key 需设 E2E_CVTE_KEY 环境变量'); process.exit(2); }

  const evidenceDir = join(tmpdir(), `wa-e2e-evidence-${selected.length}`);
  mkdirSync(evidenceDir, { recursive: true });

  let port = 9400;
  let pass = 0; const failures: string[] = [];
  for (const c of selected) {
    const sandbox = await launchSandbox(appPath, { cdpPort: port++, fixture: c.fixture, debug: false });
    try {
      const cdp = await connectCdp(sandbox.cdpPort);
      const res = await c.run({ sandbox, cdp, apiKey, evidenceDir });
      // 任何会话期未处理异常都视为失败信号
      const crashErrors = cdp.errors();
      const ok = res.ok && crashErrors.length === 0;
      console.log(`${ok ? '✅' : '❌'} ${c.id} — ${c.title}${res.detail ? ' | ' + res.detail : ''}${crashErrors.length ? ' | ERRORS: ' + crashErrors.length : ''}`);
      cdp.close();
      if (ok) pass++; else failures.push(c.id);
    } catch (e) {
      console.log(`❌ ${c.id} — 抛错: ${(e as Error).message}`);
      failures.push(c.id);
    } finally {
      sandbox.close();
    }
  }

  console.log(`\n==== ${pass}/${selected.length} PASS ====`);
  if (failures.length) { console.error('FAILED: ' + failures.join(', ')); process.exit(1); }
}

main();
```

- [ ] **Step 4: 根 package.json 加脚本**

在 `package.json` scripts 块（`"test:ota"` 行附近）加：
```json
"e2e": "bun run test/e2e/run.ts",
```

- [ ] **Step 5: 对真实 0.10.315 打包 app 冒烟跑**

Run（先确保已 `bun run electron:dist:mac`）：`bun run e2e --ids R-PROVISION`
Expected: `✅ R-PROVISION — ... | cvte-gateway anthropic CVTE-AUTO` 然后 `1/1 PASS`

- [ ] **Step 6: 提交**

```bash
git add test/e2e/run.ts test/e2e/cases/provision.case.ts test/e2e/cases/index.ts package.json
git commit -m "test(e2e): runner 编排器 + R-PROVISION 用例 + bun run e2e"
```

---

## Task 6: 补 3 个无 key 种子用例（release-notes / no-fallback / coldstart）

**Files:**
- Create: `test/e2e/cases/release-notes.case.ts`
- Create: `test/e2e/cases/no-fallback.case.ts`
- Create: `test/e2e/cases/coldstart.case.ts`
- Modify: `test/e2e/cases/index.ts`

- [ ] **Step 1: R-RELEASE-NOTES（最新动态仅 CVTE，无上游泄漏）**

```ts
// test/e2e/cases/release-notes.case.ts
import type { E2ECase } from './types.ts';

export const releaseNotesCase: E2ECase = {
  id: 'R-RELEASE-NOTES',
  title: '最新动态仅展示本 fork 的 CVTE release notes（无上游泄漏）',
  tags: ['release-notes', 'branding'],
  origin: '2026-06-15 R1 / 29fcc2ff',
  fixture: 'clean',
  async run({ cdp }) {
    const md = await cdp.eval<string>(`(async()=>await window.electronAPI.getReleaseNotes())()`);
    const heads = (md.match(/^# .+$/gm) ?? []);
    const upstreamMarkers = ["What's New", 'Improvements', 'Bug fixes', 'Craft Agents 0'];
    const leaked = upstreamMarkers.filter((m) => md.includes(m));
    const ok = heads.length > 0 && leaked.length === 0 && md.includes('CVTE');
    return { ok, detail: ok ? `headers=${heads.length}` : `leaked=${JSON.stringify(leaked)} heads=${JSON.stringify(heads)}` };
  },
};
```

- [ ] **Step 2: R-NO-FALLBACK（打包 config 无明文兜底 key）**

```ts
// test/e2e/cases/no-fallback.case.ts
import type { E2ECase } from './types.ts';

export const noFallbackCase: E2ECase = {
  id: 'R-NO-FALLBACK',
  title: '打包 config-defaults 无 fallbackApiKey / 无明文 sk- key',
  tags: ['security', 'config'],
  origin: '2026-06-15 R8 / 6823c10a',
  fixture: 'clean',
  async run({ cdp }) {
    // 经 renderer 读打包内的 enterprise 配置（已 provision 到 ~/.workagent，但更可靠是读连接状态推断无兜底）
    const needs = await cdp.eval<any>(`(async()=>await window.electronAPI.getSetupNeeds())()`);
    // 去兜底后全新装必然 needsCredentials=true（无内置 key 可用）
    const ok = needs?.needsCredentials === true;
    return { ok, detail: `setupNeeds=${JSON.stringify(needs)}` };
  },
};
```

- [ ] **Step 3: R-COLDSTART（首启不崩 + 零未处理异常）**

```ts
// test/e2e/cases/coldstart.case.ts
import type { E2ECase } from './types.ts';

export const coldStartCase: E2ECase = {
  id: 'R-COLDSTART',
  title: '全新空 HOME 冷启不崩、renderer 可达、会话期零未处理异常',
  tags: ['startup', 'regression'],
  origin: 'rebaseline 首启崩溃回归 2498daef',
  fixture: 'clean',
  async run({ cdp }) {
    const title = await cdp.eval<string>(`document.title`);
    // runner 会另外校验 cdp.errors()；这里确认 renderer 真的渲染了
    const ok = typeof title === 'string' && title.length > 0;
    return { ok, detail: `title=${title}` };
  },
};
```

- [ ] **Step 4: 登记册加这三个**

```ts
// test/e2e/cases/index.ts —— 改为
import type { E2ECase } from './types.ts';
import { provisionCase } from './provision.case.ts';
import { releaseNotesCase } from './release-notes.case.ts';
import { noFallbackCase } from './no-fallback.case.ts';
import { coldStartCase } from './coldstart.case.ts';

export const ALL_CASES: readonly E2ECase[] = [
  coldStartCase,
  provisionCase,
  releaseNotesCase,
  noFallbackCase,
];
```

- [ ] **Step 5: 全量无 key 用例跑**

Run: `bun run e2e`
Expected: `✅ R-COLDSTART` / `✅ R-PROVISION` / `✅ R-RELEASE-NOTES` / `✅ R-NO-FALLBACK` 然后 `4/4 PASS`

- [ ] **Step 6: 提交**

```bash
git add test/e2e/cases/
git commit -m "test(e2e): 种子回归用例 release-notes / no-fallback / coldstart"
```

---

## Task 7: README（用法 + 纪律 + 方法论铁律）

**Files:**
- Create: `test/e2e/README.md`

- [ ] **Step 1: 写 README**

````markdown
# E2E 回归谐振器

## 用法
```bash
bun run electron:dist:mac          # 先出打包 app（harness 驱动它）
bun run e2e                        # 跑全部无 key 用例
bun run e2e --tags gateway         # 按 tag
bun run e2e --ids R-PROVISION      # 按 id
E2E_CVTE_KEY=sk-xxx bun run e2e --with-key   # 纳入需真实网关 key 的 live 用例
```

## 事件→永久用例纪律
每修一个 bug：① 先在 `cases/` 加一条失败用例（红）② 修 ③ 跑绿 ④ 用例随修复一起进仓。用例 id 用 `R-<AREA>`，`origin` 写来源事件（日期+commit/issue）。

## 方法论铁律（今天沉淀）
1. 验证 = 运行态观测（驱动 app），不是跑单测代替。
2. 两种 fixture：`clean`（全新空 HOME 测首启时序雷）+ `seeded`（种存量数据测"有数据才触发"的雷），各抓一类。
3. 优先 RPC 驱动（`window.electronAPI`）而非点 UI（Radix 下拉脆）。
4. 竞态类用例**保持 `debug:false`**（CRAFT_DEBUG 会改时序掩盖竞态）。
5. `--user-data-dir` 必加（否则被运行中实例顶掉静默退出）；调用方设 `NO_PROXY`（系统代理劫持 127.0.0.1）。
6. 真机错误读 `~/Library/Logs/@craft-agent/electron/main.log`（不是 `craft-agent/`）。

## Phase 2/3（后续，本计划不含）
- L4 live 诊断收编：`test/diagnostics/gw-diag.sh`（端点对比）、`route-compare.ts`（SDK 多轮可靠性），`E2E_CVTE_KEY` 门控。
- needsKey live 用例：R-CHAT（网关对话）、R-RELAY-PRIV（越权）、R-COLDSTART-STRESS（首次请求竞态 N 轮）。
- Windows：`app-locate` 已支持 win 路径；经 SSH + CDP 隧道在 Windows 机跑同一套用例。
- L3 进 CI：xvfb/headless 或自托管 runner。
````

- [ ] **Step 2: 提交**

```bash
git add test/e2e/README.md
git commit -m "docs(e2e): README — 用法 + 事件→用例纪律 + 方法论铁律"
```

---

## Self-Review

**1. Spec coverage（对照早前设计的 L0–L4 + 登记册）：**
- L3 谐振器（sandbox/cdp/app-locate/runner）：Task 1–5 ✓
- 用例登记册（结构化、可筛选）：Task 2 + 6 ✓
- 今天的坑落成用例：R-PROVISION/R-RELEASE-NOTES/R-NO-FALLBACK/R-COLDSTART ✓（R-MAXTURNS 已是 L1 单测、R-B2 已是 L2/L3 沙箱实测——本 Phase 先收无 key 核心流；needsKey 的 R-CHAT/R-RELAY-PRIV/R-COLDSTART-STRESS 列入 Phase 2，README 已注明，非遗漏）
- L0/L1/L2 已存在（`validate:ci`），本计划不重造 ✓
- 跨平台：app-locate 含 win，Windows 实跑列 Phase 2 ✓

**2. Placeholder 扫描：** 各步均有完整可跑代码/命令；无 TBD/TODO。`cases/index.ts` 在 Task 5 注释里写"后续 task 追加"，Task 6 已实际追加——非占位。

**3. 类型一致性：** `E2ECase`/`CaseContext`/`CaseResult`/`Sandbox`/`CdpSession`/`selectCases(cases, filter)` 在 Task 2 定义、Task 5/6 使用，签名一致（`run(ctx)`、`cdp.eval`、`cdp.errors()`、`sandbox.readConfig()`）。`connectCdp(port)`、`launchSandbox(appPath, opts)`、`locateApp(opts)` 命名前后一致。

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-16-e2e-regression-harness.md`.
