/**
 * Filesystem SessionStore — one `${id}.json` file per shared session under
 * a data directory. The default backend: simple, durable on a real disk
 * (single VM, or a CCloud pod with a persistent volume).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionStore } from './storage.ts';

export class FsSessionStore implements SessionStore {
  constructor(private readonly dataDir: string) {
    mkdirSync(this.dataDir, { recursive: true });
  }

  private fileFor(id: string): string {
    // `id` is validated by the server before reaching here; join keeps it
    // inside dataDir and the server's charset check blocks traversal.
    return join(this.dataDir, `${id}.json`);
  }

  async put(id: string, data: Uint8Array): Promise<void> {
    writeFileSync(this.fileFor(id), data);
  }

  async get(id: string): Promise<Uint8Array | null> {
    const f = this.fileFor(id);
    if (!existsSync(f)) return null;
    return new Uint8Array(readFileSync(f));
  }

  async has(id: string): Promise<boolean> {
    return existsSync(this.fileFor(id));
  }

  async delete(id: string): Promise<void> {
    const f = this.fileFor(id);
    if (existsSync(f)) rmSync(f);
  }
}
