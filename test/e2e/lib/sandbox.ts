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
