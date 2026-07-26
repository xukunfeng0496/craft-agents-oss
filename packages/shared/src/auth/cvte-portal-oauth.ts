/**
 * CVTE 统一门户 OAuth2 — authorization_code, **public client**
 * (no client_secret, no PKCE). Endpoints, verified live against op-fat per
 * docs/CVTE-portal-sso-contract.md:
 *
 *   GET  https://{host}/portal/oauth2/authorize
 *          ?client_id&redirect_uri&response_type=code&state
 *   POST https://{host}/portal/oauth2/token        (Content-Type: application/json)
 *          { grant_type:'authorization_code', code, redirect_uri }   // no client_id in body
 *        → { access_token, expires_in }   // 120s TTL
 *   GET  https://{host}/portal/oauth2/user  (Bearer access_token) → identity incl. simUid
 *
 * token/userinfo are server-side calls (no CORS) — run them in the server/main
 * process, never the renderer. The personal-key resolution (userinfo → simUid →
 * CCH key) lives behind the intranet relay (@craft-agent/portal-key-relay), which
 * holds the admin X-Api-Key; this module only exchanges the code and forwards the
 * resulting access_token to that relay.
 */
import { randomBytes } from 'node:crypto';

export interface CvtePortalConfig {
  /** Portal host — op-fat.cvte.com (test) / home.cvte.com (prod). */
  portalHost: string;
  /** OAuth2 public client id (registered per environment). */
  clientId: string;
}

/** Identity returned by the relay (mirrors portal userinfo + derived userId). */
export interface CvtePortalIdentity {
  account?: string;
  name?: string;
  email?: string;
  simUid?: string;
  userId?: number;
}

/** Random CSRF state for the authorize round-trip. */
export function generatePortalState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Build the portal authorize URL. `redirectUri` is the loopback callback the
 * client is listening on (must be passed verbatim to {@link exchangePortalToken}).
 * URLSearchParams encodes params — do not pre-encode redirectUri.
 */
export function buildPortalAuthorizeUrl(
  cfg: CvtePortalConfig,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `https://${cfg.portalHost}/portal/oauth2/authorize?${params.toString()}`;
}

export interface CvtePortalTokens {
  accessToken: string;
  /** Unix ms; access token is short-lived (~120s). */
  expiresAt?: number;
}

/**
 * Exchange an authorization code for a portal access token. Public client:
 * JSON body with no client_secret / client_id / code_verifier. `redirectUri`
 * MUST equal the one used to build the authorize URL.
 */
export async function exchangePortalToken(
  cfg: CvtePortalConfig,
  code: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<CvtePortalTokens> {
  const res = await fetchFn(`https://${cfg.portalHost}/portal/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Portal token exchange failed: ${res.status} ${text}`.trim());
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Portal token response missing access_token');
  }
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

export interface RelayResolvedKey {
  apiKey: string;
  identity: CvtePortalIdentity;
}

/**
 * Hand the portal access token to the intranet relay, which resolves the user's
 * personal CCH (token.cvte.com) gateway key server-side and returns it. The
 * admin key never leaves the relay.
 */
/** Stable marker so the renderer can recognize "relay couldn't be reached" (vs an
 * HTTP error) and show a friendly message instead of a raw "fetch failed". */
export const RELAY_UNREACHABLE = 'RELAY_UNREACHABLE';

export async function resolvePersonalKeyViaRelay(
  relayUrl: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<RelayResolvedKey> {
  const base = relayUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchFn(`${base}/api/resolve-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
  } catch (err) {
    // Transport-level failure (relay not running / unreachable / untrusted TLS).
    // Node fetch throws a bare "fetch failed" — surface a recognizable, actionable error.
    const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
    throw new Error(`${RELAY_UNREACHABLE}: ${base}${code ? ` (${code})` : ''}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`Key relay failed: ${res.status} ${detail}`.trim());
  }
  const data = (await res.json()) as Partial<RelayResolvedKey>;
  if (!data.apiKey) {
    throw new Error('Key relay response missing apiKey');
  }
  return { apiKey: data.apiKey, identity: data.identity ?? {} };
}
