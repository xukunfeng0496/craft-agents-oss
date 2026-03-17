import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSystemPrompt } from './system.ts';

describe('getSystemPrompt skill qualification guidance', () => {
  const testDirs: string[] = [];

  afterEach(() => {
    for (const dir of testDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('documents both workspace and .agents skill prefixes and bans bare slugs', () => {
    const workspaceRoot = join(tmpdir(), `system-prompt-skill-${Date.now()}`);
    testDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'craft-workspace-my-workspace', version: '1.0.0' })
    );

    const prompt = getSystemPrompt(undefined, undefined, workspaceRoot);

    expect(prompt).toContain('craft-workspace-my-workspace:skill-slug');
    expect(prompt).toContain('.agents:skill-slug');
    expect(prompt).toContain('Never invoke a skill with a bare slug');
    expect(prompt).toContain('<available_skills>');
  });
});
