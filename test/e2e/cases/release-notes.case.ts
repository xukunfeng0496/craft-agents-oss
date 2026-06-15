import type { E2ECase } from './types.ts';

export const releaseNotesCase: E2ECase = {
  id: 'R-RELEASE-NOTES',
  title: '最新动态仅展示本 fork 的 CVTE release notes（无上游泄漏）',
  tags: ['release-notes', 'branding'],
  origin: '2026-06-15 R1 / 29fcc2ff',
  fixture: 'clean',
  async run({ cdp }) {
    const md = await cdp.eval<string>(`(async()=>await window.electronAPI.getReleaseNotes())()`);
    const heads = (md.match(/^# .+$/gm) ?? []);
    const upstreamMarkers = ["What's New", 'Improvements', 'Bug fixes', 'Craft Agents 0'];
    const leaked = upstreamMarkers.filter((m) => md.includes(m));
    const ok = heads.length > 0 && leaked.length === 0 && md.includes('CVTE');
    return { ok, detail: ok ? `headers=${heads.length}` : `leaked=${JSON.stringify(leaked)} heads=${JSON.stringify(heads)}` };
  },
};
