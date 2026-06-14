import { describe, it, expect } from 'bun:test';
import { resolveUserKey, type RelayConfig } from './resolve.ts';

const CFG: RelayConfig = {
  portalHost: 'op-fat.cvte.com',
  cchBase: 'https://token.cvte.com',
  cchAdminKey: 'admin-x-key',
  cchAuthScheme: 'x-api-key',
  autoCreateKey: false,
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (status: number) => new Response('err', { status });

// Build a fetch mock from a route→response map; records calls for assertions.
// Route keys are matched with url.includes(); keep them specific enough that the
// user-lookup (`/api/v1/users?q=`) and key-list (`/api/v1/users/<id>/keys`) URLs
// never collide.
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
  it('happy path: portal username → users lookup → list → reveal → full key', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '00001528', account: 'luoxiaowei', name: '雒小伟', email: 'l@cvte.com' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 968, name: 'luoxiaowei', isEnabled: true }] }),
      '/api/v1/users/968/keys': () => ok({ items: [{ id: 1559, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/1559:reveal': () => ok({ key: 'sk-luoxiaowei-real' }),
    });
    const res = await resolveUserKey('tok', CFG, fn);
    expect(res.apiKey).toBe('sk-luoxiaowei-real');
    expect(res.identity).toEqual({ account: 'luoxiaowei', name: '雒小伟', email: 'l@cvte.com', simUid: '00001528', userId: 968 });
    // username is sent to the CCH lookup; admin key never echoed to the portal.
    const portalCall = calls.find((c) => c.url.includes('/portal/oauth2/user'))!;
    expect((portalCall.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const lookupCall = calls.find((c) => c.url.includes('/api/v1/users?q='))!;
    expect(lookupCall.url).toContain('q=luoxiaowei');
    expect((lookupCall.init?.headers as Record<string, string>)['X-Api-Key']).toBe('admin-x-key');
  });

  it('SECURITY: username with many same-name rows resolves to the single enabled id (no cross-account leak)', async () => {
    // Regression for the parseInt(simUid)-as-userId bug. CCH returns 15 rows for
    // "i_zhangjiarui" (14 disabled + 1 enabled); we must pick id=3509 (enabled)
    // and must NOT touch any disabled user's keys.
    const dupRows = Array.from({ length: 14 }, (_, i) => ({ id: 3495 + i, name: 'i_zhangjiarui', isEnabled: false }));
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ simUid: '9999', account: 'i_zhangjiarui' }),
      '/api/v1/users?q=': () => ok({ items: [...dupRows, { id: 3509, name: 'i_zhangjiarui', isEnabled: true }] }),
      '/api/v1/users/3509/keys': () => ok({ items: [{ id: 3629, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/3629:reveal': () => ok({ key: 'sk-correct-owner' }),
    });
    const res = await resolveUserKey('t', CFG, fn);
    expect(res.apiKey).toBe('sk-correct-owner');
    expect(res.identity.userId).toBe(3509);
    // must only have listed keys for the enabled user, never a disabled one
    expect(calls.some((c) => c.url.includes('/api/v1/users/3509/keys'))).toBe(true);
    expect(calls.some((c) => /\/api\/v1\/users\/349\d\/keys/.test(c.url))).toBe(false);
  });

  it('SECURITY: fuzzy q= matches are filtered to the exact username', async () => {
    // q= is a fuzzy search; "luoxiaowei" must not resolve to "luoxiaowei2".
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'luoxiaowei' }),
      '/api/v1/users?q=': () => ok({ items: [
        { id: 111, name: 'luoxiaowei2', isEnabled: true },
        { id: 968, name: 'luoxiaowei', isEnabled: true },
      ] }),
      '/api/v1/users/968/keys': () => ok({ items: [{ id: 7, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/7:reveal': () => ok({ key: 'sk-exact' }),
    });
    const res = await resolveUserKey('t', CFG, fn);
    expect(res.apiKey).toBe('sk-exact');
    expect(res.identity.userId).toBe(968);
  });

  it('cchAuthScheme=bearer sends the admin-user key as Bearer on CCH calls', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': () => ok({ items: [{ id: 9, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/9:reveal': () => ok({ key: 'sk-via-bearer' }),
    });
    const res = await resolveUserKey('t', { ...CFG, cchAuthScheme: 'bearer', cchAdminKey: 'admin-user-key' }, fn);
    expect(res.apiKey).toBe('sk-via-bearer');
    const lookupCall = calls.find((c) => c.url.includes('/api/v1/users?q='))!;
    const h = lookupCall.init?.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer admin-user-key');
    expect(h['X-Api-Key']).toBeUndefined();
  });

  it('picks the enabled key when several keys exist', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': () => ok({ items: [{ id: 1, isEnabled: false, deletedAt: null }, { id: 2, isEnabled: true, deletedAt: null }] }),
      '/api/v1/keys/2:reveal': () => ok({ key: 'sk-enabled' }),
    });
    expect((await resolveUserKey('t', CFG, fn)).apiKey).toBe('sk-enabled');
  });

  it('rejects an invalid portal token → 401', async () => {
    const { fn } = mockFetch({ '/portal/oauth2/user': () => err(401) });
    await expect(resolveUserKey('bad', CFG, fn)).rejects.toMatchObject({ status: 401 });
  });

  it('portal user has no account/username → 502, never hits CCH', async () => {
    const { fn, calls } = mockFetch({ '/portal/oauth2/user': () => ok({ simUid: '1528' }) });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 502 });
    expect(calls.some((c) => c.url.includes('/api/v1/users'))).toBe(false);
  });

  it('no active CCH user for the username → 404', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'ghost' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 1, name: 'ghost', isEnabled: false }] }), // only a disabled row
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 404 });
    expect(calls.some((c) => c.url.includes('/keys'))).toBe(false);
  });

  it('ambiguous: >1 enabled row for the same username → 409, never reveals', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'dupe' }),
      '/api/v1/users?q=': () => ok({ items: [
        { id: 1, name: 'dupe', isEnabled: true },
        { id: 2, name: 'dupe', isEnabled: true },
      ] }),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 409 });
    expect(calls.some((c) => c.url.includes('/keys'))).toBe(false);
  });

  it('CCH user lookup failure → 502', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => err(500),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 502 });
  });

  it('no key + autoCreate=false → 404', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': () => ok({ items: [] }),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 404 });
  });

  it('all keys disabled/deleted → 404, never reveals a non-working key (regression)', async () => {
    const { fn, calls } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': () => ok({ items: [
        { id: 1, isEnabled: false, deletedAt: null },
        { id: 2, isEnabled: true, deletedAt: '2026-01-01' },
      ] }),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 404 });
    expect(calls.some((c) => c.url.includes(':reveal'))).toBe(false);
  });

  it('no key + autoCreate=true → creates (full key from create response)', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': (init) => init?.method === 'POST'
        ? ok({ id: 77, key: 'sk-newly-created' })
        : ok({ items: [] }),
    });
    expect((await resolveUserKey('t', { ...CFG, autoCreateKey: true }, fn)).apiKey).toBe('sk-newly-created');
  });

  it('create returns no key field → reveals the created id', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': (init) => init?.method === 'POST' ? ok({ id: 88 }) : ok({ items: [] }),
      '/api/v1/keys/88:reveal': () => ok({ key: 'sk-revealed-after-create' }),
    });
    expect((await resolveUserKey('t', { ...CFG, autoCreateKey: true }, fn)).apiKey).toBe('sk-revealed-after-create');
  });

  it('empty accessToken → 400', async () => {
    const { fn } = mockFetch({});
    await expect(resolveUserKey('', CFG, fn)).rejects.toMatchObject({ status: 400 });
  });

  it('CCH list keys failure → 502', async () => {
    const { fn } = mockFetch({
      '/portal/oauth2/user': () => ok({ account: 'u' }),
      '/api/v1/users?q=': () => ok({ items: [{ id: 5, name: 'u', isEnabled: true }] }),
      '/api/v1/users/5/keys': () => err(500),
    });
    await expect(resolveUserKey('t', CFG, fn)).rejects.toMatchObject({ status: 502 });
  });
});
