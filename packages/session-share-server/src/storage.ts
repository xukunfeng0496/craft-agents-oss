/**
 * Pluggable blob store for shared session transcripts.
 *
 * Each shared session is one opaque JSON blob keyed by a short id. The store
 * never parses the blob — the server validates it before calling put(). Two
 * built-in backends:
 *   - filesystem (default): one file per session under DATA_DIR. Perfect for a
 *     single VM or a CCloud pod with a persistent volume.
 *   - S3 / MinIO: for ephemeral / multi-replica deploys (CCloud without a PVC).
 */
export interface SessionStore {
  /** Store (create or overwrite) the blob for `id`. */
  put(id: string, data: Uint8Array): Promise<void>;
  /** Return the blob for `id`, or null if it does not exist. */
  get(id: string): Promise<Uint8Array | null>;
  /** Whether a blob for `id` exists. */
  has(id: string): Promise<boolean>;
  /** Delete the blob for `id`. Idempotent — deleting a missing id is a no-op. */
  delete(id: string): Promise<void>;
}

export interface StorageConfig {
  /** 'fs' (default) or 's3'. */
  backend: 'fs' | 's3';
  /** Filesystem: directory that holds `${id}.json` files. */
  dataDir: string;
  /** S3: bucket, region, endpoint (MinIO), credentials, key prefix. */
  s3?: {
    bucket: string;
    region: string;
    /** Custom endpoint for MinIO / S3-compatible stores (omit for AWS S3). */
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    /** Path-style addressing — required for MinIO. Default true when endpoint is set. */
    forcePathStyle?: boolean;
    /** Key prefix inside the bucket, e.g. 'sessions/'. */
    prefix?: string;
  };
}

/** Build a SessionStore from config. Lazily imports the chosen backend. */
export async function createStore(config: StorageConfig): Promise<SessionStore> {
  if (config.backend === 's3') {
    if (!config.s3?.bucket) {
      throw new Error('STORAGE=s3 requires S3_BUCKET');
    }
    const { S3SessionStore } = await import('./storage-s3.ts');
    return new S3SessionStore(config.s3);
  }
  const { FsSessionStore } = await import('./storage-fs.ts');
  return new FsSessionStore(config.dataDir);
}

/** Read storage config from the environment. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const backend = (env.STORAGE ?? 'fs').toLowerCase() === 's3' ? 's3' : 'fs';
  return {
    backend,
    dataDir: env.DATA_DIR ?? './session-store',
    s3: backend === 's3'
      ? {
          bucket: env.S3_BUCKET ?? '',
          region: env.S3_REGION ?? 'us-east-1',
          endpoint: env.S3_ENDPOINT || undefined,
          accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
          forcePathStyle: env.S3_FORCE_PATH_STYLE
            ? env.S3_FORCE_PATH_STYLE === 'true'
            : !!env.S3_ENDPOINT,
          prefix: env.S3_PREFIX || undefined,
        }
      : undefined,
  };
}
