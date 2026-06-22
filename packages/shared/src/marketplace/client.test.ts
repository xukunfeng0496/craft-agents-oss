import { describe, it, expect, afterEach } from 'bun:test';
import {
  MarketplaceClient,
  isMarketplaceConnectivityError,
  isMarketplaceAuthError,
  marketplaceAuthMessage,
} from './client.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request) =>
    handler(typeof input === 'string' ? input : input.toString())) as unknown as typeof fetch;
}

async function caught(p: Promise<unknown>): Promise<Error> {
  try { await p; } catch (e) { return e as Error; }
  throw new Error('expected rejection');
}

describe('MarketplaceClient error classification', () => {
  it('regression: a login-required 401 is an AUTH error, NOT a connectivity error', async () => {
    // The original bug: "Skill files fetch failed: 401" matched the 'fetch failed'
    // connectivity heuristic and was mislabeled "check your network".
    stubFetch(() => json({ error: '需要登录后才能下载，请运行: cskills login' }, 401));
    const err = await caught(new MarketplaceClient().getSkillFiles('adb-logcat'));
    expect(isMarketplaceAuthError(err)).toBe(true);
    expect(isMarketplaceConnectivityError(err)).toBe(false); // <-- the fix
    expect(marketplaceAuthMessage(err)).toBe('需要登录后才能下载，请运行: cskills login');
  });

  it('treats 403 the same as 401 (auth required)', async () => {
    stubFetch(() => json({ error: 'forbidden' }, 403));
    const err = await caught(new MarketplaceClient().getSkillFiles('x'));
    expect(isMarketplaceAuthError(err)).toBe(true);
    expect(isMarketplaceConnectivityError(err)).toBe(false);
  });

  it('a genuine transport failure IS a connectivity error', async () => {
    stubFetch(() => { throw new TypeError('fetch failed'); });
    const err = await caught(new MarketplaceClient().getRegistry());
    expect(isMarketplaceConnectivityError(err)).toBe(true);
    expect(isMarketplaceAuthError(err)).toBe(false);
  });

  it('a 500 is neither connectivity nor auth (surfaces the real status)', async () => {
    stubFetch(() => json({ error: 'boom' }, 500));
    const err = await caught(new MarketplaceClient().getRegistry());
    expect(isMarketplaceConnectivityError(err)).toBe(false);
    expect(isMarketplaceAuthError(err)).toBe(false);
    expect(err.message).toContain('500');
  });

  it('happy path: registry parses', async () => {
    stubFetch(() => json({ version: '1', skills: [{ name: 'a' }] }));
    const reg = await new MarketplaceClient().getRegistry();
    expect(reg.skills?.[0]?.name).toBe('a');
  });
});
