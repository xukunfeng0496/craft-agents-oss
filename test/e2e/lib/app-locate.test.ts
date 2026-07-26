import { describe, it, expect } from 'bun:test';
import { locateApp } from './app-locate.ts';

describe('locateApp', () => {
  it('mac arm64 → release/mac-arm64 的 .app 二进制', () => {
    const p = locateApp({ platform: 'darwin', arch: 'arm64', repoRoot: '/repo' });
    expect(p).toBe('/repo/apps/electron/release/mac-arm64/Work Agents.app/Contents/MacOS/Work Agents');
  });
  it('win32 → %LOCALAPPDATA% 的单用户安装路径', () => {
    const p = locateApp({ platform: 'win32', arch: 'x64', repoRoot: '/repo', localAppData: 'C:/Users/u/AppData/Local' });
    expect(p).toBe('C:/Users/u/AppData/Local/Programs/work-agents/Work Agents.exe');
  });
  it('不支持的平台 → 抛错', () => {
    expect(() => locateApp({ platform: 'freebsd' as any, arch: 'x64', repoRoot: '/repo' })).toThrow(/unsupported/i);
  });
});
