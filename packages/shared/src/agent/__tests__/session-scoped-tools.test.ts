import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSession } from '../../sessions/storage.ts';
import { cleanupSessionScopedTools, getSessionScopedTools } from '../session-scoped-tools.ts';

function executeSessionTool(
  server: ReturnType<typeof getSessionScopedTools>,
  name: string,
  args: Record<string, unknown>
) {
  const tool = (server as any).instance._registeredTools[name];
  if (!tool) {
    throw new Error(`Tool "${name}" not found`);
  }
  return tool.handler(args);
}

describe('session-scoped tool output paths', () => {
  let workspaceRoot: string;
  let workingRoot: string;
  const sessionIds: string[] = [];

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-session-tools-workspace-'));
    workingRoot = mkdtempSync(join(tmpdir(), 'craft-session-tools-working-'));
  });

  afterEach(() => {
    for (const sessionId of sessionIds) {
      cleanupSessionScopedTools(sessionId);
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(workingRoot, { recursive: true, force: true });
    sessionIds.length = 0;
  });

  it('writes transform_data output to the session folder root when no working directory is set', async () => {
    const session = await createSession(workspaceRoot);
    sessionIds.push(session.id);

    const server = getSessionScopedTools(session.id, workspaceRoot, undefined, session.runtimeDirectory);
    const result = await executeSessionTool(server, 'transform_data', {
      language: 'node',
      script: "const fs = require('fs'); fs.writeFileSync(process.argv.at(-1), 'ok');",
      inputFiles: [],
      outputFile: 'result.txt',
    });

    const outputPath = join(workspaceRoot, 'sessions', session.id, 'result.txt');
    expect(result.content[0].text).toContain(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(join(workspaceRoot, 'sessions', session.id, 'data', 'result.txt'))).toBe(false);
  });

  it('writes transform_data output to the visible working directory and allows chaining via relative input files', async () => {
    const session = await createSession(workspaceRoot, {
      workingDirectory: workingRoot,
      isolateSessionDirectory: true,
    });
    sessionIds.push(session.id);

    const outputRoot = session.workingDirectory!;
    const runtimeRoot = session.runtimeDirectory!;
    const server = getSessionScopedTools(session.id, workspaceRoot, undefined, runtimeRoot);

    await executeSessionTool(server, 'transform_data', {
      language: 'node',
      script: "const fs = require('fs'); fs.writeFileSync(process.argv.at(-1), 'alpha');",
      inputFiles: [],
      outputFile: 'first.txt',
    });

    const firstPath = join(outputRoot, 'first.txt');
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(join(runtimeRoot, 'data', 'first.txt'))).toBe(false);

    await executeSessionTool(server, 'transform_data', {
      language: 'node',
      script: "const fs = require('fs'); const args = process.argv.slice(2); fs.writeFileSync(args.at(-1), fs.readFileSync(args[0], 'utf8').toUpperCase());",
      inputFiles: ['first.txt'],
      outputFile: 'second.txt',
    });

    const secondPath = join(outputRoot, 'second.txt');
    expect(existsSync(secondPath)).toBe(true);
    expect(readFileSync(secondPath, 'utf-8')).toBe('ALPHA');
    expect(existsSync(join(runtimeRoot, 'data', 'second.txt'))).toBe(false);
  });
});
