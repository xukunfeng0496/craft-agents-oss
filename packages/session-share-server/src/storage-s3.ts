/**
 * S3 / MinIO SessionStore — for ephemeral or multi-replica deploys (e.g. a
 * CCloud pod without a persistent volume). Works with AWS S3 and any
 * S3-compatible store (MinIO) via a custom endpoint + path-style addressing.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { SessionStore, StorageConfig } from './storage.ts';

type S3Config = NonNullable<StorageConfig['s3']>;

export class S3SessionStore implements SessionStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(cfg: S3Config) {
    this.bucket = cfg.bucket;
    this.prefix = cfg.prefix ?? '';
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
      ...(cfg.accessKeyId && cfg.secretAccessKey
        ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }
        : {}),
    });
  }

  private key(id: string): string {
    return `${this.prefix}${id}.json`;
  }

  async put(id: string, data: Uint8Array): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(id),
      Body: data,
      ContentType: 'application/json',
    }));
  }

  async get(id: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      if (!res.Body) return null;
      return new Uint8Array(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async has(id: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    // S3 DeleteObject is idempotent — succeeds even if the key is absent.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
