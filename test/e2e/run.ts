import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { locateApp } from './lib/app-locate.ts';
import { launchSandbox, type Sandbox } from './lib/sandbox.ts';
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

/** I2: 等待 window.electronAPI 就绪，最多 15s；超时后继续（不阻塞无 electronAPI 用例）。*/
async function waitForElectronAPI(cdp: Awaited<ReturnType<typeof connectCdp>>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const t = await cdp.eval<string>("typeof window.electronAPI");
      if (t === 'object') return;
    } catch { /* renderer 尚未就绪 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  // 超时后继续，让用例自行决定（coldstart 无 electronAPI 属正常）
}

async function main() {
  const filter = parseArgs(process.argv.slice(2));
  const selected = selectCases(ALL_CASES, filter);

  // M5: filter 匹配不到用例时报错退出（避免 CI 误判通过）
  if (selected.length === 0) {
    console.warn('警告：没有用例匹配当前 filter，请检查 --tags / --ids 参数');
    process.exit(2);
  }

  const appPath = locateApp();
  const apiKey = filter.withKey ? process.env.E2E_CVTE_KEY : undefined;
  if (filter.withKey && !apiKey) { console.error('--with-key 需设 E2E_CVTE_KEY 环境变量'); process.exit(2); }

  // M1: 使用 mkdtempSync 保证 evidenceDir 唯一，避免并发冲突
  const evidenceDir = mkdtempSync(join(tmpdir(), 'wa-e2e-evidence-'));
  mkdirSync(evidenceDir, { recursive: true });

  let port = 9400;
  let pass = 0; const failures: string[] = [];
  for (const c of selected) {
    // I1: launchSandbox 放在 try 内；抛错时记入 failures 而非中止整个套件
    let sandbox: Sandbox | undefined;
    try {
      sandbox = await launchSandbox(appPath, { cdpPort: port++, fixture: c.fixture, debug: false });
      const cdp = await connectCdp(sandbox.cdpPort);

      // I2: 等待 window.electronAPI 就绪
      await waitForElectronAPI(cdp);

      const res = await c.run({ sandbox, cdp, apiKey, evidenceDir });

      // C1: 使用 collectErrors() 合并 live + 页内缓冲
      const crashErrors = await cdp.collectErrors();
      const ok = res.ok && crashErrors.length === 0;

      // M3: 失败时打印实际错误内容
      const errorDetail = crashErrors.length
        ? ` | ERRORS(${crashErrors.length}): ` + crashErrors.join('; ').slice(0, 400)
        : '';
      console.log(`${ok ? '✅' : '❌'} ${c.id} — ${c.title}${res.detail ? ' | ' + res.detail : ''}${errorDetail}`);
      cdp.close();
      if (ok) pass++; else failures.push(c.id);
    } catch (e) {
      console.log(`❌ ${c.id} — 抛错: ${(e as Error).message}`);
      failures.push(c.id);
    } finally {
      sandbox?.close();
    }
  }

  console.log(`\n==== ${pass}/${selected.length} PASS ====`);
  if (failures.length) { console.error('FAILED: ' + failures.join(', ')); process.exit(1); }
}

// I1: 顶层错误捕获，确保非零退出
main().catch((e) => { console.error(e); process.exit(1); });
