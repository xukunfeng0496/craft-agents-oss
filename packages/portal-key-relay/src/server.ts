/**
 * HTTP handler for the portal-key relay.
 *
 *   POST /api/resolve-key   body { accessToken }  → 200 { apiKey, identity }
 *   GET  /healthz                                  → 200 ok
 *
 * No client auth: the desktop's portal access token IS the proof of identity
 * (verified against the portal). Protect at the network layer (intranet-only).
 */
import { resolveUserKey, RelayError, type RelayConfig } from './resolve.ts';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createHandler(cfg: RelayConfig, fetchFn: typeof fetch = fetch) {
  return async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === '/healthz' && req.method === 'GET') {
      return new Response('ok', { status: 200 });
    }

    if (pathname === '/api/resolve-key' && req.method === 'POST') {
      let accessToken: string | undefined;
      try {
        const body = (await req.json()) as { accessToken?: string };
        accessToken = body.accessToken;
      } catch {
        return json({ error: 'invalid JSON body' }, 400);
      }
      if (!accessToken) return json({ error: 'accessToken required' }, 400);

      try {
        const result = await resolveUserKey(accessToken, cfg, fetchFn);
        return json(result, 200);
      } catch (err) {
        if (err instanceof RelayError) return json({ error: err.message }, err.status);
        return json({ error: err instanceof Error ? err.message : 'resolve failed' }, 500);
      }
    }

    return json({ error: 'not found' }, 404);
  };
}
