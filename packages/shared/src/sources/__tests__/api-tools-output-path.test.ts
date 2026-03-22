import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApiTool } from '../api-tools.ts';

describe('createApiTool binary output path', () => {
  const originalFetch = globalThis.fetch;
  let runtimePath: string;
  let outputPath: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'craft-api-tool-'));
    runtimePath = join(root, 'runtime');
    outputPath = join(root, 'output');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(join(runtimePath, '..'), { recursive: true, force: true });
  });

  it('saves binary responses directly into the visible output folder', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(Buffer.from('%PDF-test'), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
      },
    })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const tool = createApiTool(
      {
        name: 'files',
        baseUrl: 'https://api.example.com',
        documentation: 'Test API',
        auth: { type: 'none' },
      },
      '',
      runtimePath,
      undefined,
      outputPath,
    ) as any;

    const result = await tool.handler({
      path: '/reports/invoice.pdf',
      method: 'GET',
    });

    const payload = JSON.parse(result.content[0].text);
    const savedPath = join(outputPath, 'invoice.pdf');

    expect(payload.type).toBe('file_download');
    expect(payload.path).toBe(savedPath);
    expect(existsSync(savedPath)).toBe(true);
    expect(readFileSync(savedPath).toString()).toBe('%PDF-test');
    expect(existsSync(join(runtimePath, 'downloads', 'invoice.pdf'))).toBe(false);
  });
});
