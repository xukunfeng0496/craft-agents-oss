/**
 * Session-share HTTP handler — the `/s/api` store behind apps/viewer.
 *
 * Contract (extracted from the Work Agents client `SessionManager` and the
 * viewer `App.tsx`; see docs/deployment/intranet-session-viewer.md):
 *   POST   /s/api        body=StoredSession JSON  → 201 { id, url }   (create)
 *   GET    /s/api/:id                              → 200 StoredSession (read; 404 if missing)
 *   PUT    /s/api/:id    body=StoredSession JSON  → 200               (update; 404 if missing)
 *   DELETE /s/api/:id                              → 200               (revoke; idempotent)
 *
 * Write auth: defense-in-depth on top of network-layer access control. When
 * `writeSecret` is set, POST returns a per-share `editToken = HMAC(secret, id)`
 * and PUT/DELETE require a matching `x-edit-token` header — so knowing a share id
 * is not enough to overwrite or revoke it. Stateless (no token storage; derivable
 * from id + secret → works across replicas). When `writeSecret` is unset the
 * behaviour is unchanged (rely on network-layer control); the client always
 * stores+sends whatever token it received, so enabling the secret is seamless.
 * The store never parses the blob; this handler does the minimal validity check
 * the viewer also does (`id` + `messages` array) and enforces size / id charset.
 */
import { createHmac } from 'node:crypto';
import type { SessionStore } from './storage.ts';

export interface ServerConfig {
  /** Public origin users open a share at — must equal enterprise.viewerUrl. No trailing slash. */
  publicBase: string;
  /** Reject bodies larger than this with 413 (client shows "too large to share"). */
  maxBytes: number;
  /** When set, PUT/DELETE require `x-edit-token` = HMAC-SHA256(writeSecret, id). */
  writeSecret?: string;
}

/** Per-share write token, derivable from the share id + the server secret. */
function editTokenFor(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url');
}

// Must match the viewer route regex `^/s/([a-zA-Z0-9_-]+)$`.
const ID_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

function newId(len = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ID_CHARSET[b % ID_CHARSET.length];
  return s;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Build the request handler. Pure over (store, config) — directly unit-testable. */
export function createHandler(store: SessionStore, config: ServerConfig) {
  return async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    // Liveness probe (handy for k8s / load balancers).
    if (pathname === '/healthz' && req.method === 'GET') {
      return new Response('ok', { status: 200 });
    }

    // POST /s/api — create a new share.
    if (pathname === '/s/api' && req.method === 'POST') {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.byteLength > config.maxBytes) return new Response('Payload too large', { status: 413 });
      if (!isValidSession(body)) return new Response('Invalid session', { status: 400 });
      const id = newId();
      await store.put(id, body);
      const editToken = config.writeSecret ? editTokenFor(id, config.writeSecret) : undefined;
      return json({ id, url: `${config.publicBase}/s/${id}`, ...(editToken ? { editToken } : {}) }, 201);
    }

    // GET | PUT | DELETE /s/api/:id
    const m = pathname.match(/^\/s\/api\/([^/]+)$/);
    if (m) {
      const id = m[1]!;
      if (!VALID_ID.test(id)) return new Response('Bad id', { status: 400 });

      // Write auth (defense-in-depth): mutations require the per-share edit token.
      if ((req.method === 'PUT' || req.method === 'DELETE') && config.writeSecret) {
        if (req.headers.get('x-edit-token') !== editTokenFor(id, config.writeSecret)) {
          return new Response('Forbidden', { status: 403 });
        }
      }

      if (req.method === 'GET') {
        const data = await store.get(id);
        if (!data) return new Response('Not found', { status: 404 });
        return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (req.method === 'PUT') {
        const body = new Uint8Array(await req.arrayBuffer());
        if (body.byteLength > config.maxBytes) return new Response('Payload too large', { status: 413 });
        if (!(await store.has(id))) return new Response('Not found', { status: 404 });
        if (!isValidSession(body)) return new Response('Invalid session', { status: 400 });
        await store.put(id, body);
        return new Response(null, { status: 200 });
      }

      if (req.method === 'DELETE') {
        await store.delete(id); // idempotent
        return new Response(null, { status: 200 });
      }
    }

    return new Response('Not found', { status: 404 });
  };
}

/** Mirror the viewer's own validity check: a JSON object with `id` + `messages` array. */
function isValidSession(body: Uint8Array): boolean {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return !!parsed?.id && Array.isArray(parsed?.messages);
  } catch {
    return false;
  }
}
