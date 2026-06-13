import { describe, it, expect } from 'bun:test';
import {
  buildPortalAuthorizeUrl,
  exchangePortalToken,
  resolvePersonalKeyViaRelay,
  generatePortalState,
  type CvtePortalConfig,
} from './cvte-portal-oauth.ts';

const CFG: CvtePortalConfig = { portalHost: 'op-fat.cvte.com', clientId: 'cid-123' };
const REDIRECT = 'http://127.0.0.1:6477/callback';

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Capture a promise's rejection as an Error (bun's `.rejects.toThrow` typing
 * mis-flags `await` — assert on the captured message instead). */
async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected promise to reject, but it resolved');
}

describe('buildPortalAuthorizeUrl', () => {
  it('builds an authorize URL with encoded redirect_uri + state, no scope', () => {
    const url = buildPortalAuthorizeUrl(CFG, REDIRECT, 'st8');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://op-fat.cvte.com/portal/oauth2/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid-123');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT); // decoded back ⇒ was encoded
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('st8');
    expect(u.searchParams.has('scope')).toBe(false);
    expect(u.searchParams.has('client_secret')).toBe(false);
  });
});

describe('generatePortalState', () => {
  it('returns a 32-char hex string and is unique per call', () => {
    const a = generatePortalState();
    const b = generatePortalState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('exchangePortalToken', () => {
  it('POSTs JSON {grant_type,code,redirect_uri} with no client_id/secret, returns access token', async () => {
    const { fn, calls } = mockFetch((url) => {
      expect(url).toBe('https://op-fat.cvte.com/portal/oauth2/token');
      return ok({ access_token: 'at-xyz', expires_in: 120 });
    });
    const tokens = await exchangePortalToken(CFG, 'code-1', REDIRECT, fn);
    expect(tokens.accessToken).toBe('at-xyz');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const init = calls[0]!.init!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: REDIRECT });
    expect(body.client_id).toBeUndefined();
    expect(body.client_secret).toBeUndefined();
    expect(body.code_verifier).toBeUndefined();
  });

  it('throws with status + body on non-2xx', async () => {
    const { fn } = mockFetch(() => new Response('code expired', { status: 400 }));
    expect((await rejection(exchangePortalToken(CFG, 'bad', REDIRECT, fn))).message).toMatch(/400.*code expired/);
  });

  it('throws when access_token is missing', async () => {
    const { fn } = mockFetch(() => ok({ token_type: 'bearer' }));
    expect((await rejection(exchangePortalToken(CFG, 'c', REDIRECT, fn))).message).toMatch(/missing access_token/);
  });
});

describe('resolvePersonalKeyViaRelay', () => {
  it('POSTs the access token and returns apiKey + identity', async () => {
    const { fn, calls } = mockFetch((url) => {
      expect(url).toBe('http://relay:8788/api/resolve-key');
      return ok({ apiKey: 'sk-personal', identity: { account: 'luoxiaowei', userId: 1528 } });
    });
    const res = await resolvePersonalKeyViaRelay('http://relay:8788', 'at-xyz', fn);
    expect(res.apiKey).toBe('sk-personal');
    expect(res.identity.userId).toBe(1528);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ accessToken: 'at-xyz' });
  });

  it('strips a trailing slash from relayUrl', async () => {
    const { fn, calls } = mockFetch(() => ok({ apiKey: 'sk' }));
    await resolvePersonalKeyViaRelay('http://relay:8788/', 'at', fn);
    expect(calls[0]!.url).toBe('http://relay:8788/api/resolve-key');
  });

  it('surfaces the relay error body on failure', async () => {
    const { fn } = mockFetch(() => new Response(JSON.stringify({ error: 'user has no key' }), { status: 404 }));
    expect((await rejection(resolvePersonalKeyViaRelay('http://relay:8788', 'at', fn))).message).toMatch(/404.*user has no key/);
  });

  it('throws when apiKey is missing', async () => {
    const { fn } = mockFetch(() => ok({ identity: {} }));
    expect((await rejection(resolvePersonalKeyViaRelay('http://relay:8788', 'at', fn))).message).toMatch(/missing apiKey/);
  });
});
