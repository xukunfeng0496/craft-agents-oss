/**
 * Bun entrypoint for the CVTE portal-key relay.
 *
 * Env:
 *   PORT             listen port (default 8788)
 *   PORTAL_HOST      portal host (op-fat.cvte.com test / home.cvte.com prod)
 *   CCH_BASE         CCH base (default https://token.cvte.com)
 *   CCH_ADMIN_KEY    CCH X-Api-Key (required) — server-side only
 *   AUTO_CREATE_KEY  'true' to provision a key when the user has none
 */
import { createHandler } from './server.ts';
import { relayConfigFromEnv } from './resolve.ts';

const PORT = Number(process.env.PORT ?? 8788);
const cfg = relayConfigFromEnv();
const handle = createHandler(cfg);

Bun.serve({ port: PORT, fetch: handle });

console.log(
  `[portal-key-relay] :${PORT} portal=${cfg.portalHost} cch=${cfg.cchBase} autoCreate=${cfg.autoCreateKey}`,
);
