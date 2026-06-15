import type { E2ECase } from './types.ts';

export const coldStartCase: E2ECase = {
  id: 'R-COLDSTART',
  title: '全新空 HOME 冷启不崩、renderer 可达、会话期零未处理异常',
  tags: ['startup', 'regression'],
  origin: 'rebaseline 首启崩溃回归 2498daef',
  fixture: 'clean',
  async run({ cdp }) {
    const title = await cdp.eval<string>(`document.title`);
    // runner 会另外校验 cdp.errors()；这里确认 renderer 真的渲染了
    const ok = typeof title === 'string' && title.length > 0;
    return { ok, detail: `title=${title}` };
  },
};
