/**
 * Bun entrypoint for the CVTE session-share backend.
 *
 * Env:
 *   PORT                 listen port (default 8787)
 *   PUBLIC_BASE          public origin of the viewer; equals enterprise.viewerUrl (no trailing slash)
 *   MAX_BYTES            max transcript size before 413 (default 25 MiB)
 *   STORAGE              'fs' (default) | 's3'
 *   DATA_DIR             fs: directory for ${id}.json (default ./session-store)
 *   S3_BUCKET/S3_REGION/S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_FORCE_PATH_STYLE/S3_PREFIX
 */
import { createHandler } from './server.ts';
import { createStore, storageConfigFromEnv } from './storage.ts';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_BASE = (process.env.PUBLIC_BASE ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 25 * 1024 * 1024);
// Optional write-auth: when set, PUT/DELETE require the per-share edit token.
const WRITE_SECRET = process.env.SHARE_WRITE_SECRET || undefined;

const storageConfig = storageConfigFromEnv();
const store = await createStore(storageConfig);
const handle = createHandler(store, { publicBase: PUBLIC_BASE, maxBytes: MAX_BYTES, writeSecret: WRITE_SECRET });

Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_BYTES + 1024,
  fetch: handle,
});

console.log(
  `[session-share] :${PORT} storage=${storageConfig.backend}` +
    `${storageConfig.backend === 'fs' ? ` dir=${storageConfig.dataDir}` : ` bucket=${storageConfig.s3?.bucket}`}` +
    ` public=${PUBLIC_BASE} maxBytes=${MAX_BYTES} writeAuth=${WRITE_SECRET ? 'on' : 'off'}`,
);
