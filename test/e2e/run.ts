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
