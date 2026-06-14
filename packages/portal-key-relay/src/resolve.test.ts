import { describe, it, expect } from 'bun:test';
import { resolveUserKey, RelayError, type RelayConfig } from './resolve.ts';

const CFG: RelayConfig = {
  portalHost: 'op-fat.cvte.com',
  cchBase: 'https://token.cvte.com',
  cchAdminKey: 'admin-x-key',
  autoCreateKey: false,
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (status: number) => new Response('err', { status });

// Build a fetch mock from a route→response map; records calls for assertions.
function mockFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return routes[key]!(init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('resolveUserKey', () => {
  it('happy path: portal → simUid → list → reveal → full key', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '00001528', account: 'luoxiaowei', name: '雒小伟', email: 'l@cvte.com' }),
      '/api/v1/users/1528/keys': () => ok({ items: [{ id: 1559, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/1559:reveal': () => ok({ key: 'sk-cdac-full-secret-8111' }),
    });
    const res = await resolveUserKey('tok', CFG, fn);
    expect(res.apiKey).toBe('sk-cdac-full-secret-8111');
    expect(res.identity).toEqual({ account: 'luoxiaowei', name: '雒小伟', email: 'l@cvte.com', simUid: '00001528', userId: 1528 });
    // admin key only on CCH calls, never echoed to portal
    const portalCall = calls.find((c) => c.url.includes('/portal/oauth2/user'))!;
    expect((portalCall.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const revealCall = calls.find((c) => c.url.includes(':reveal'))!;
    expect((revealCall.init?.headers as Record<string, string>)['X-Api-Key']).toBe('admin-x-key');
  });

  it('picks the enabled key when several exist', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': () => ok({ items: [{ id: 1, isEnabled: false, deletedAt: null }, { id: 2, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/2:reveal': () => ok({ key: 'sk-enabled' }),
    });
    expect((await resolveUserKey('t', CFG, fn)).apiKey).toBe('sk-enabled');
  });

  it('rejects an invalid portal token → 401', async () => {
    const { fn } = mockFetch({ '/portal/oauth2/user': () => err(401) });
    await expect(resolveUserKey('bad', CFG, fn)).rejects.toMatchObject({ status: 401 });
  });

  it('non-numeric simUid → 502', async () => {
    const { fn } = mockFetch({ '/portal/oauth2/user': () => ok({ simUid: 'not-a-number', account: 'u' }) });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toBeInstanceOf(RelayError);
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 502 });
  });

  it('no key + autoCreate=false → 404', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': () => ok({ items: [] }),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 404 });
  });

  it('all keys disabled/deleted → 404, never reveals a non-working key (regression)', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': () => ok({ items: [
        { id: 1, isEnabled: false, deletedAt: null },
        { id: 2, isEnabled: true, deletedAt: '2026-01-01' },
      ] }),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 404 });
    // must NOT have attempted to reveal the disabled/deleted key
    expect(calls.some((c) => c.url.includes(':reveal'))).toBe(false);
  });

  it('no key + autoCreate=true → creates (full key from create response)', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': (init) => init?.method === 'POST'
        ? ok({ id: 77, key: 'sk-newly-created' })
        : ok({ items: [] }),
    });
    expect((await resolveUserKey('t', { ...CFG, autoCreateKey: true }, fn)).apiKey).toBe('sk-newly-created');
  });

  it('create returns no key field → reveals the created id', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': (init) => init?.method === 'POST' ? ok({ id: 88 }) : ok({ items: [] }),
      '/api/v1/keys/88:reveal': () => ok({ key: 'sk-revealed-after-create' }),
    });
    expect((await resolveUserKey('t', { ...CFG, autoCreateKey: true }, fn)).apiKey).toBe('sk-revealed-after-create');
  });

  it('empty accessToken → 400', async () => {
    const { fn } = mockFetch({});
    await expect(resolveUserKey('', CFG, fn)).rejects.toMatchObject({ status: 400 });
  });

  it('CCH list failure → 502', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '1528', account: 'u' }),
      '/api/v1/users/1528/keys': () => err(500),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 502 });
  });
});
