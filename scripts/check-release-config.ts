/**
 * Release-config gate (review P0-2).
 *
 * Fails a PRODUCTION package build when apps/electron/resources/config-defaults.json
 * still carries test / placeholder values — so a DMG/EXE/AppImage can never ship
 * pointing at the op-fat test portal, the shared test client_id, a localhost /
 * non-https relay, or the known plaintext fallback key.
 *
 * Wired into electron:dist:{mac,win,linux} (production). Skipped — with a loud
 * warning instead of a failure — for:
 *   - dev builds:           CRAFT_DEV_RUNTIME=1   (electron:dist:dev:*)
 *   - intentional test pkg: CRAFT_ALLOW_TEST_CONFIG=1
 * so the op-fat test DMGs we hand out for verification still build, explicitly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CONFIG_PATH = join(import.meta.dir, '..', 'apps', 'electron', 'resources', 'config-defaults.json');

// Known test / placeholder values (must be replaced before a production release).
const TEST_PORTAL_HOST = 'op-fat.cvte.com';
const TEST_CLIENT_ID = 'e1fe00c2088543f3b7ade4d7fb7f4e5c';
// SHA-256 of the leaked plaintext fallback key. The key itself is deliberately
// NOT stored in source (purged) — we denylist by hash, so a stale config that
// re-adds the plaintext is still caught at build time without keeping the secret here.
const LEAKED_FALLBACK_KEY_SHA256 = 'b6372e6ba35904d7c4f1063d0777be6e1711864c86c08acccbd4bc4c15dd6574';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface ReleaseConfigIssue {
  field: string;
  reason: string;
}

/** Pure check — returns the list of release-blocking config issues (empty = ok). */
export function findReleaseConfigIssues(
  cfg: unknown,
  leakedKeyHashes: readonly string[] = [LEAKED_FALLBACK_KEY_SHA256],
): ReleaseConfigIssue[] {
  const issues: ReleaseConfigIssue[] = [];
  const enterprise = (cfg as { enterprise?: Record<string, any> })?.enterprise;
  if (!enterprise) return issues; // non-enterprise build — nothing to gate

  const sso = enterprise.sso;
  if (sso) {
    if (sso.portalHost === TEST_PORTAL_HOST) {
      issues.push({ field: 'enterprise.sso.portalHost', reason: `测试门户 (${TEST_PORTAL_HOST})，发布须改为 home.cvte.com` });
    }
    if (sso.clientId === TEST_CLIENT_ID) {
      issues.push({ field: 'enterprise.sso.clientId', reason: '共享测试 client_id，发布须用 ITSM 注册的生产值' });
    }
    if (typeof sso.relayUrl === 'string' && /127\.0\.0\.1|localhost|^http:\/\//i.test(sso.relayUrl)) {
      issues.push({ field: 'enterprise.sso.relayUrl', reason: `localhost / 非 https 占位 (${sso.relayUrl})，发布须用内网 https relay` });
    }
  }

  const fallbackKey = enterprise.defaultLlmConnection?.fallbackApiKey;
  if (typeof fallbackKey === 'string' && fallbackKey.length > 0 && leakedKeyHashes.includes(sha256Hex(fallbackKey))) {
    issues.push({
      field: 'enterprise.defaultLlmConnection.fallbackApiKey',
      reason: '已入 git 历史的明文兜底 key（按 SHA-256 比对），发布须轮换为受限/可吊销的 key',
    });
  }

  return issues;
}

function main(): void {
  const bypassReason =
    process.env.CRAFT_DEV_RUNTIME === '1' ? 'CRAFT_DEV_RUNTIME=1 (dev build)' :
    process.env.CRAFT_ALLOW_TEST_CONFIG === '1' ? 'CRAFT_ALLOW_TEST_CONFIG=1' :
    null;

  let cfg: unknown;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`[check-release-config] cannot read ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const issues = findReleaseConfigIssues(cfg);

  if (issues.length === 0) {
    console.log('[check-release-config] ✓ no test/placeholder values in config-defaults.json');
    return;
  }

  const header = bypassReason ? '⚠️  [check-release-config] test/placeholder config detected' : '❌ [check-release-config] release blocked — test/placeholder config';
  console.error(`\n${header}:\n`);
  for (const i of issues) console.error(`  • ${i.field} — ${i.reason}`);

  if (bypassReason) {
    console.error(`\n  Allowed because ${bypassReason}. NEVER distribute this build as a production release.\n`);
    return;
  }
  console.error('\n  Backfill production values in apps/electron/resources/config-defaults.json, or, for an');
  console.error('  intentional test package, re-run with CRAFT_ALLOW_TEST_CONFIG=1.\n');
  process.exit(1);
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.main) main();
