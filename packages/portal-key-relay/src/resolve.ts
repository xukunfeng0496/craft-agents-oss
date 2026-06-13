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
  /** CCH admin service key (X-Api-Key). Server-side only — never to the client. */
  cchAdminKey: string;
  /** Create a key when the user has none (returns the full key once). */
  autoCreateKey: boolean;
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

  // 1. Verify the portal token → identity.
  const userRes = await fetchFn(`https://${cfg.portalHost}/portal/oauth2/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) {
    throw new RelayError(401, `portal token rejected (${userRes.status})`);
  }
  const user = (await userRes.json()) as { simUid?: string; account?: string; name?: string; email?: string };
  const simUid = user.simUid;
  const userId = Number.parseInt(String(simUid ?? ''), 10);
  if (!simUid || !Number.isInteger(userId)) {
    throw new RelayError(502, `portal user has no numeric simUid (got ${JSON.stringify(simUid)})`);
  }

  // 2. List the user's CCH keys.
  const cchHeaders = { 'X-Api-Key': cfg.cchAdminKey, Accept: 'application/json' };
  const listRes = await fetchFn(`${cfg.cchBase}/api/v1/users/${userId}/keys`, { headers: cchHeaders });
  if (!listRes.ok) {
    throw new RelayError(502, `CCH list keys failed (${listRes.status})`);
  }
  const list = (await listRes.json()) as { items?: Array<{ id: number; isEnabled?: boolean; deletedAt?: string | null }> };
  const enabled = (list.items ?? []).find((k) => k.isEnabled && !k.deletedAt) ?? (list.items ?? [])[0];

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
    identity: { account: user.account ?? '', name: user.name, email: user.email, simUid, userId },
  };
}

async function revealKey(cfg: RelayConfig, keyId: number, fetchFn: FetchFn): Promise<string | undefined> {
  const res = await fetchFn(`${cfg.cchBase}/api/v1/keys/${keyId}:reveal`, {
    headers: { 'X-Api-Key': cfg.cchAdminKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new RelayError(502, `CCH reveal key failed (${res.status})`);
  const body = (await res.json()) as { key?: string };
  return body.key;
}

export function relayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const portalHost = env.PORTAL_HOST ?? 'op-fat.cvte.com';
  const cchBase = (env.CCH_BASE ?? 'https://token.cvte.com').replace(/\/+$/, '');
  const cchAdminKey = env.CCH_ADMIN_KEY ?? '';
  if (!cchAdminKey) throw new Error('CCH_ADMIN_KEY is required (the CCH X-Api-Key service credential)');
  return { portalHost, cchBase, cchAdminKey, autoCreateKey: env.AUTO_CREATE_KEY === 'true' };
}
