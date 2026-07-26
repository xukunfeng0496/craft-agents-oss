/**
 * Resolve a user's personal CCH (token.cvte.com) gateway API key from a verified
 * CVTE portal OAuth access token.
 *
 * Why this lives server-side: the CCH admin key (X-Api-Key) can reveal ANY
 * user's key, so it must never reach the desktop client. The desktop proves the
 * caller's identity by handing over its short-lived portal access token; this
 * relay verifies it against the portal, maps it to the CCH user, and returns
 * ONLY that user's own key.
 *
 * Flow (each step verified live against op-fat + token.cvte.com, 2026-06-13):
 *   1. GET  {portal}/portal/oauth2/user        (Bearer accessToken) → { simUid, account, ... }
 *   2. userId = parseInt(simUid, 10)            (CCH userId == numeric simUid)
 *   3. GET  {cch}/api/v1/users/{userId}/keys    (X-Api-Key)         → pick an enabled key
 *   4a. none + autoCreate → POST .../keys       → full key (one-shot)
 *   4b. else → GET {cch}/api/v1/keys/{keyId}:reveal (X-Api-Key)     → full key
 */
export interface RelayConfig {
  /** Portal host, e.g. `op-fat.cvte.com` (test) or `home.cvte.com` (prod). */
  portalHost: string;
  /** CCH base, e.g. `https://token.cvte.com` (no trailing slash). */
  cchBase: string;
  /** CCH admin credential. Server-side only — never to the client. Prefer a
   * revocable, per-person admin-USER API key (CCH `users.role='admin'` +
   * `ENABLE_API_KEY_ADMIN_ACCESS=true`, sent as Bearer) over the raw static
   * ADMIN_TOKEN (X-Api-Key) — the user key can be rotated/revoked/audited. */
  cchAdminKey: string;
  /** How to present cchAdminKey to CCH: 'bearer' for an admin-user API key
   * (recommended), 'x-api-key' for the raw ADMIN_TOKEN. */
  cchAuthScheme: 'bearer' | 'x-api-key';
  /** Create a key when the user has none (returns the full key once). */
  autoCreateKey: boolean;
}

/** Build the CCH admin auth header for the configured scheme. */
function cchAuthHeaders(cfg: RelayConfig): Record<string, string> {
  return cfg.cchAuthScheme === 'bearer'
    ? { Authorization: `Bearer ${cfg.cchAdminKey}`, Accept: 'application/json' }
    : { 'X-Api-Key': cfg.cchAdminKey, Accept: 'application/json' };
}

export interface ResolvedIdentity {
  account: string;
  name?: string;
  email?: string;
  simUid: string;
  userId: number;
}

export interface ResolveResult {
  apiKey: string;
  identity: ResolvedIdentity;
}

/** HTTP error with a status the server maps straight to the response. */
export class RelayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

type FetchFn = typeof fetch;

export async function resolveUserKey(
  accessToken: string,
  cfg: RelayConfig,
  fetchFn: FetchFn = fetch,
): Promise<ResolveResult> {
  if (!accessToken?.trim()) throw new RelayError(400, 'accessToken required');

  // 1. Verify the portal token → identity. The portal reliably returns the
  // username (account). simUid is an employee number, NOT the CCH user id.
  const userRes = await fetchFn(`https://${cfg.portalHost}/portal/oauth2/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) {
    throw new RelayError(401, `portal token rejected (${userRes.status})`);
  }
  const user = (await userRes.json()) as { simUid?: string; account?: string; name?: string; email?: string };
  const username = user.account?.trim();
  if (!username) {
    throw new RelayError(502, `portal user has no account/username (got ${JSON.stringify(user.account)})`);
  }

  const cchHeaders = cchAuthHeaders(cfg);

  // 2. Resolve the CCH user id by username. CRITICAL: CCH `users.id` is an
  // autoincrement primary key with NO relation to the portal simUid (employee
  // number) — using parseInt(simUid) as the id fetched a DIFFERENT user's keys
  // (cross-account key leak). CCH keeps several rows per username over time, and
  // `status=active` does NOT drop the disabled ones (observed: 15 rows for one
  // username — 14 with isEnabled=false + 1 true). So we filter on the `isEnabled`
  // flag ourselves and require an exact name match (`q=` is a fuzzy search). Any
  // non-unique result is rejected, so an ambiguous lookup can never hand back
  // another user's key — verified across the full users table that
  // (name, isEnabled=true, non-deleted) is globally unique.
  const lookupUrl = `${cfg.cchBase}/api/v1/users?q=${encodeURIComponent(username)}&status=active&limit=100`;
  const lookupRes = await fetchFn(lookupUrl, { headers: cchHeaders });
  if (!lookupRes.ok) {
    throw new RelayError(502, `CCH user lookup failed (${lookupRes.status})`);
  }
  const lookup = (await lookupRes.json()) as { items?: Array<{ id: number; name: string; isEnabled?: boolean }> };
  const matches = (lookup.items ?? []).filter((u) => u.name === username && u.isEnabled === true);
  if (matches.length === 0) {
    throw new RelayError(404, `no active CCH user for username ${JSON.stringify(username)}`);
  }
  if (matches.length > 1) {
    throw new RelayError(409, `ambiguous username ${JSON.stringify(username)}: ${matches.length} active CCH users`);
  }
  const userId = matches[0].id;

  // 3. List the user's CCH keys.
  const listRes = await fetchFn(`${cfg.cchBase}/api/v1/users/${userId}/keys`, { headers: cchHeaders });
  if (!listRes.ok) {
    throw new RelayError(502, `CCH list keys failed (${listRes.status})`);
  }
  const list = (await listRes.json()) as { items?: Array<{ id: number; isEnabled?: boolean; deletedAt?: string | null }> };
  // Only an enabled, non-deleted key is usable. Do NOT fall back to items[0] —
  // that would reveal a disabled/deleted key (a non-working credential). When no
  // usable key exists, the !enabled branch below provisions one or returns 404.
  const enabled = (list.items ?? []).find((k) => k.isEnabled && !k.deletedAt);

  let apiKey: string | undefined;

  if (!enabled) {
    if (!cfg.autoCreateKey) {
      throw new RelayError(404, `user ${userId} has no gateway key (set AUTO_CREATE_KEY=true to provision)`);
    }
    // 3a. Provision a key — create returns the full value once.
    const createRes = await fetchFn(`${cfg.cchBase}/api/v1/users/${userId}/keys`, {
      method: 'POST',
      headers: { ...cchHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'work-agents' }),
    });
    if (!createRes.ok) throw new RelayError(502, `CCH create key failed (${createRes.status})`);
    const created = (await createRes.json()) as { key?: string; id?: number };
    apiKey = created.key ?? (created.id != null ? await revealKey(cfg, created.id, fetchFn) : undefined);
  } else {
    // 3b. Reveal the existing key's full value.
    apiKey = await revealKey(cfg, enabled.id, fetchFn);
  }

  if (!apiKey) throw new RelayError(502, 'CCH returned no key value');

  return {
    apiKey,
    identity: { account: username, name: user.name, email: user.email, simUid: user.simUid ?? '', userId },
  };
}

async function revealKey(cfg: RelayConfig, keyId: number, fetchFn: FetchFn): Promise<string | undefined> {
  const res = await fetchFn(`${cfg.cchBase}/api/v1/keys/${keyId}:reveal`, {
    headers: cchAuthHeaders(cfg),
  });
  if (!res.ok) throw new RelayError(502, `CCH reveal key failed (${res.status})`);
  const body = (await res.json()) as { key?: string };
  return body.key;
}

export function relayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const portalHost = env.PORTAL_HOST ?? 'op-fat.cvte.com';
  const cchBase = (env.CCH_BASE ?? 'https://token.cvte.com').replace(/\/+$/, '');
  const cchAdminKey = env.CCH_ADMIN_KEY ?? '';
  if (!cchAdminKey) throw new Error('CCH_ADMIN_KEY is required (CCH admin credential — prefer a revocable admin-user API key)');
  // 'bearer' = revocable admin-user API key (recommended); 'x-api-key' = raw ADMIN_TOKEN (default, back-compat).
  const cchAuthScheme = env.CCH_AUTH_SCHEME === 'bearer' ? 'bearer' : 'x-api-key';
  return { portalHost, cchBase, cchAdminKey, cchAuthScheme, autoCreateKey: env.AUTO_CREATE_KEY === 'true' };
}
