import { describe, it, expect, beforeEach } from 'bun:test';
import { createHandler } from './server.ts';
import type { SessionStore } from './storage.ts';

// In-memory store so the handler logic is tested without touching disk/S3.
class MemStore implements SessionStore {
  map = new Map<string, Uint8Array>();
  async put(id: string, data: Uint8Array) { this.map.set(id, data); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async has(id: string) { return this.map.has(id); }
  async delete(id: string) { this.map.delete(id); }
}

const CONFIG = { publicBase: 'https://viewer.example.cvte.cn', maxBytes: 1024 };
const session = (extra: Record<string, unknown> = {}) =>
  new TextEncoder().encode(JSON.stringify({ id: 'sess-1', messages: [], ...extra }));
const req = (method: string, path: string, body?: Uint8Array) =>
  new Request(`http://x${path}`, { method, ...(body ? { body } : {}) });

let store: MemStore;
let handle: (r: Request) => Promise<Response>;
beforeEach(() => { store = new MemStore(); handle = createHandler(store, CONFIG); });

describe('session-share handler', () => {
  it('POST /s/api creates a share and returns { id, url }', async () => {
    const res = await handle(req('POST', '/s/api', session()));
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; url: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(body.url).toBe(`${CONFIG.publicBase}/s/${body.id}`);
    expect(store.map.has(body.id)).toBe(true);
  });

  it('full lifecycle: create → read → update → delete → 404', async () => {
    const id = (await (await handle(req('POST', '/s/api', session()))).json() as { id: string }).id;

    const got = await handle(req('GET', `/s/api/${id}`));
    expect(got.status).toBe(200);
    expect((await got.json() as { id: string }).id).toBe('sess-1');

    const put = await handle(req('PUT', `/s/api/${id}`, session({ name: 'renamed' })));
    expect(put.status).toBe(200);
    expect((await (await handle(req('GET', `/s/api/${id}`))).json() as { name: string }).name).toBe('renamed');

    expect((await handle(req('DELETE', `/s/api/${id}`))).status).toBe(200);
    expect((await handle(req('GET', `/s/api/${id}`))).status).toBe(404);
  });

  it('GET unknown id → 404', async () => {
    expect((await handle(req('GET', '/s/api/doesnotexist'))).status).toBe(404);
  });

  it('PUT unknown id → 404', async () => {
    expect((await handle(req('PUT', '/s/api/nope', session()))).status).toBe(404);
  });

  it('DELETE is idempotent (missing id → 200)', async () => {
    expect((await handle(req('DELETE', '/s/api/never'))).status).toBe(200);
  });

  it('POST oversized body → 413', async () => {
    const big = new Uint8Array(CONFIG.maxBytes + 1);
    expect((await handle(req('POST', '/s/api', big))).status).toBe(413);
  });

  it('POST invalid session (no messages array) → 400', async () => {
    const bad = new TextEncoder().encode(JSON.stringify({ id: 'x' }));
    expect((await handle(req('POST', '/s/api', bad))).status).toBe(400);
  });

  it('rejects path-traversal / bad id charset → 400', async () => {
    expect((await handle(req('GET', '/s/api/..%2F..%2Fetc'))).status).toBe(400);
    expect((await handle(req('GET', '/s/api/has.dot'))).status).toBe(400);
  });

  it('healthz → 200, unknown route → 404', async () => {
    expect((await handle(req('GET', '/healthz'))).status).toBe(200);
    expect((await handle(req('GET', '/'))).status).toBe(404);
    expect((await handle(req('POST', '/s/api/x', session()))).status).toBe(404);
  });
});
