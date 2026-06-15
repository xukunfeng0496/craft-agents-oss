import type { Sandbox } from '../lib/sandbox.ts';
import type { CdpSession } from '../lib/cdp.ts';

export interface CaseContext {
  sandbox: Sandbox;
  cdp: CdpSession;
  /** 仅 needsKey 用例可用；从 E2E_CVTE_KEY 环境变量注入，绝不入库。*/
  apiKey?: string;
  /** 评估辅助：在 renderer 上下文 await 一段表达式。*/
  evidenceDir: string;
}

export interface CaseResult {
  ok: boolean;
  detail?: string;
  /** 采集到的证据文件（截图/日志片段）相对路径。*/
  evidence?: string[];
}

export interface E2ECase {
  id: string;
  title: string;
  tags: string[];
  /** 来源事件，如 '2026-06-15 #34'。*/
  origin: string;
  /** 'clean' = 全新空 HOME；'seeded' = 种存量数据；其它字符串 = 自定义 fixture 名。*/
  fixture: 'clean' | 'seeded' | string;
  /** 需要真实网关 key 才能跑（live 用例）。*/
  needsKey?: boolean;
  run(ctx: CaseContext): Promise<CaseResult>;
}

export interface SelectFilter {
  tags?: string[];
  ids?: string[];
  /** 默认 false：排除 needsKey 用例（无 key 也能跑核心回归）。*/
  withKey?: boolean;
}

export function selectCases(cases: readonly E2ECase[], filter: SelectFilter): E2ECase[] {
  return cases.filter((c) => {
    if (filter.ids?.length) return filter.ids.includes(c.id);
    if (c.needsKey && !filter.withKey) return false;
    if (filter.tags?.length && !filter.tags.some((t) => c.tags.includes(t))) return false;
    return true;
  });
}
