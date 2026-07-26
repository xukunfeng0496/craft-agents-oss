# Skills Marketplace 重新集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 工作树：`.worktrees/feat/skills-marketplace-reintegration`（分支 `feat/skills-marketplace-reintegration`，基于 `cvte/rebase-0.10.3-rc`）。

**Goal:** 把先前移除的 skills.gz.cvte.cn in-app 技能市场恢复，鉴权从 BrowserWindow OAuth+cookie 换成 `X-CSkills-User-Account`/`X-CSkills-User-Email` 两个 header，身份复用门户 SSO 并持久化。

**Architecture:** `git revert b43d2d93`（实测零冲突）一键恢复旧市场 UI/客户端/RPC/类型/i18n；随后做鉴权外科适配——客户端发 header 而非 cookie、handler 读持久化身份、删 OAuth 窗与 login/logout/auth-status 链路、市场"登录"动作改触发现有 portal SSO。

**Tech Stack:** Bun monorepo、Electron、React、RPC（`@craft-agent/server-core` handlers + `protocol/channels`）、`@craft-agent/shared/marketplace`、门户 SSO（`@craft-agent/shared/auth/cvte-portal-oauth`）。

**Engineering Assessment:** Just right — 复用经 review 的成熟实现（revert 恢复），仅一处鉴权适配 + 一个 config 身份字段；无新抽象。详见同目录 `-design.md`。

---

## 实测契约（执行时勿改）

- `GET /api/registry`（浏览，开放）→ `{version, updatedAt, skills[], groups}`（与旧 `MarketplaceRegistry` 兼容）。
- `GET /api/skills/{name}/files`（安装，**需 header**，无则 401）→ `{name, files:[{path, content}]}`。
- 鉴权头：`X-CSkills-User-Account`（必需）、`X-CSkills-User-Email`（可选，有则发）。
- 身份来源：`CvtePortalIdentity { account?, name?, email?, simUid?, userId? }`，由 `resolvePersonalKeyViaRelay()` 返回（`RelayResolvedKey { apiKey, identity }`）。

---

## File Structure

| 文件 | 职责 | 本计划动作 |
|------|------|-----------|
| `packages/shared/src/marketplace/client.ts` | 市场 HTTP 客户端 | revert 恢复 → 改鉴权 cookie→header |
| `packages/shared/src/marketplace/{types,index}.ts` | 数据模型/导出 | revert 恢复（不改） |
| `packages/shared/src/marketplace/client.test.ts` | 客户端单测 | revert 恢复 → 改 header 断言 |
| `packages/server-core/src/handlers/rpc/marketplace.ts` | 市场 RPC handler | revert 恢复 → cookie→身份、删 login/logout/authStatus |
| `packages/shared/src/config/storage.ts` | `StoredConfig` | 加 `cvteIdentity` 字段 |
| `packages/shared/src/config/index.ts`(或子文件) | config getter/setter | 加 `get/setCvteIdentity` |
| `packages/server-core/src/handlers/rpc/llm-connections.ts` | 门户 SSO 完成 | resolve-key 后持久化身份 |
| `apps/electron/src/main/marketplace-auth.ts` | BrowserWindow OAuth | **删除** |
| `apps/electron/src/main/platform.ts`、`packages/server-core/src/runtime/platform.ts` | `marketplaceAuth` 平台服务 | 去掉 marketplaceAuth 装配 |
| `packages/shared/src/protocol/{channels,routing}.ts`、`apps/electron/src/transport/channel-map.ts`、`apps/electron/src/shared/types.ts`、`apps/electron/src/preload/bootstrap.ts` | RPC 契约 | revert 恢复 → 删 LOGIN/LOGOUT/GET_AUTH_STATUS |
| `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` | 市场 UI | revert 恢复 → 登录动作改触发 portal SSO，去 authStatus |
| `packages/shared/src/i18n/locales/*.json` | i18n | revert 恢复（按需微调） |

---

## Task 0: revert 恢复市场 + 复位版本 + 基线编译

**Files:** 由 `git revert` 决定（6 删除文件恢复 + ~19 修改文件）；`package.json`、`apps/electron/package.json`。

- [ ] **Step 1: revert 移除提交（不自动提交）**

```bash
cd .worktrees/feat/skills-marketplace-reintegration
git revert --no-commit --no-edit b43d2d93
git status --short   # 期望：6 个 marketplace 文件为新增(A)，其余为修改(M)，无 UU 冲突
```

- [ ] **Step 2: 复位版本号到 0.10.316（revert 会把版本回退）**

`git show b43d2d93` 含 `package.json` 版本行回退；恢复为当前基线 `0.10.316`：

```bash
# 两处版本都确认为 0.10.316
grep '"version"' package.json apps/electron/package.json
# 若被 revert 改回旧值，手动改回 0.10.316（仅版本行）
```

- [ ] **Step 3: 基线编译（恢复态=旧 OAuth 市场，应可编译）**

Run: `bun run typecheck:all`
Expected: PASS（恢复的是移除前可编译状态；若失败记录漂移点，后续任务会替换这些 OAuth 依赖）

- [ ] **Step 4: 提交基线**

```bash
git add -A
git commit -m "revert(marketplace): 恢复 skills.gz 市场到移除前状态(b43d2d93 反向)"
```

---

## Task 1: 客户端鉴权 cookie → header

**Files:**
- Modify: `packages/shared/src/marketplace/client.ts`
- Test: `packages/shared/src/marketplace/client.test.ts`

- [ ] **Step 1: 改单测断言为 header（先写失败测试）**

在 `client.test.ts` 加/改用例（mock fetch 捕获 headers）：

```ts
import { describe, it, expect, vi } from 'vitest'
import { MarketplaceClient } from './client.ts'

it('sends X-CSkills-User-Account/Email headers (not Cookie)', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = new MarketplaceClient({ account: 'luoxiaowei', email: 'luoxiaowei@cvte.com' })
  await client.getSkillFiles('portal-cli-login')
  const init = fetchMock.mock.calls[0][1] as RequestInit
  const headers = (init.headers ?? {}) as Record<string, string>
  expect(headers['X-CSkills-User-Account']).toBe('luoxiaowei')
  expect(headers['X-CSkills-User-Email']).toBe('luoxiaowei@cvte.com')
  expect(headers['Cookie']).toBeUndefined()
})

it('omits email header when not provided', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ skills: [], version: 1, updatedAt: '' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await new MarketplaceClient({ account: 'luoxiaowei' }).getRegistry()
  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
  expect(headers['X-CSkills-User-Account']).toBe('luoxiaowei')
  expect('X-CSkills-User-Email' in headers).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && bun test src/marketplace/client.test.ts`
Expected: FAIL（当前 `MarketplaceClientOptions` 仍是 `cookie`，无 account/email）

- [ ] **Step 3: 改 client.ts 的 options 与 headers()**

替换 `MarketplaceClientOptions` 与构造/headers：

```ts
export interface MarketplaceClientOptions {
  registryUrl?: string;
  /** CVTE 工号账号 — 作为 X-CSkills-User-Account 发送（详情/安装需要）。 */
  account?: string;
  /** 邮箱 — 作为 X-CSkills-User-Email 发送（可选）。 */
  email?: string;
}

export class MarketplaceClient {
  private baseUrl: string;
  private account?: string;
  private email?: string;

  constructor(options?: MarketplaceClientOptions | string) {
    const opts = typeof options === 'string' ? { registryUrl: options } : (options ?? {});
    this.baseUrl = (opts.registryUrl || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
    this.account = opts.account || undefined;
    this.email = opts.email || undefined;
  }

  private headers(): Record<string, string> | undefined {
    if (!this.account) return undefined;
    const h: Record<string, string> = { 'X-CSkills-User-Account': this.account };
    if (this.email) h['X-CSkills-User-Email'] = this.email;
    return h;
  }
  // getRegistry()/getSkillFiles() 主体不变（仍用 this.headers()）
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/shared && bun test src/marketplace/client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/marketplace/client.ts packages/shared/src/marketplace/client.test.ts
git commit -m "feat(marketplace): 客户端鉴权改用 X-CSkills-User-Account/Email header"
```

---

## Task 2: config 持久化身份字段 + getter/setter

**Files:**
- Modify: `packages/shared/src/config/storage.ts`（`StoredConfig`）
- Modify: `packages/shared/src/config/index.ts`（或与现有 getter 同文件；执行时按现有 getter 落点放置）
- Test: 同目录 `__tests__` 加 `cvte-identity.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/config/__tests__/cvte-identity.test.ts
import { describe, it, expect } from 'vitest'
import { getCvteIdentity, setCvteIdentity } from '../index.ts'

it('round-trips cvteIdentity through config', () => {
  setCvteIdentity({ account: 'luoxiaowei', email: 'luoxiaowei@cvte.com' })
  expect(getCvteIdentity()).toEqual({ account: 'luoxiaowei', email: 'luoxiaowei@cvte.com' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && bun test src/config/__tests__/cvte-identity.test.ts`
Expected: FAIL（getter/setter 不存在）

- [ ] **Step 3: 加 StoredConfig 字段**

在 `storage.ts` 的 `StoredConfig` 末尾（其它可选字段附近）加：

```ts
  // CVTE 身份（门户 SSO 持久化，用于 skills.gz 市场 header 鉴权；account 非密、email 非密）
  cvteIdentity?: { account: string; email?: string };
```

- [ ] **Step 4: 加 getter/setter（仿现有简单 getter 落点）**

```ts
export function getCvteIdentity(): { account: string; email?: string } | undefined {
  return loadStoredConfig()?.cvteIdentity;
}

export function setCvteIdentity(identity: { account: string; email?: string }): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.cvteIdentity = { account: identity.account, ...(identity.email ? { email: identity.email } : {}) };
  saveConfig(config);
}
```

> 执行注意：`loadStoredConfig`/`saveConfig` 的导入与导出路径以现有 config 模块为准；若现有 getter 在子文件（如 `llm-connections.ts`）请遵循同位置/同导出风格，并确保经 `packages/shared/src/index.ts` 或 config 子路径导出。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/shared && bun test src/config/__tests__/cvte-identity.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/config/
git commit -m "feat(config): 持久化 CVTE 门户身份 cvteIdentity(account/email)"
```

---

## Task 3: 门户 SSO 完成时持久化身份

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/llm-connections.ts`（resolve-key 完成处）

- [ ] **Step 1: 定位 resolve 调用**

```bash
grep -n 'resolvePersonalKeyViaRelay' packages/server-core/src/handlers/rpc/llm-connections.ts
```
读出 `const { apiKey, identity } = await resolvePersonalKeyViaRelay(...)` 所在 handler。

- [ ] **Step 2: 在拿到 identity 后持久化 account（若有）**

在该 handler 中 `apiKey`/`identity` 可用之后、setupLlmConnection 附近插入：

```ts
import { setCvteIdentity } from '@craft-agent/shared/config'
// ...
if (identity?.account) {
  setCvteIdentity({ account: identity.account, email: identity.email })
}
```

> 仅在 `identity.account` 存在时写入（fail-soft，绝不阻断 SSO 主流程）。

- [ ] **Step 3: 编译**

Run: `bun run typecheck:all`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/server-core/src/handlers/rpc/llm-connections.ts
git commit -m "feat(sso): 门户登录成功后持久化身份供市场鉴权复用"
```

---

## Task 4: 市场 handler 改用持久化身份 + 删 login/logout/authStatus

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/marketplace.ts`

- [ ] **Step 1: 替换整文件为身份驱动版（删 OAuth 分支）**

```ts
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getCvteIdentity } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.marketplace.GET_REGISTRY,
  RPC_CHANNELS.marketplace.INSTALL_SKILL,
] as const

/** 用持久化的门户身份构造市场客户端（account 作为鉴权 header；浏览开放、安装需鉴权）。 */
function buildClient(MarketplaceClient: typeof import('@craft-agent/shared/marketplace').MarketplaceClient) {
  const id = getCvteIdentity()
  return new MarketplaceClient({ account: id?.account, email: id?.email })
}

export function registerMarketplaceHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.marketplace.GET_REGISTRY, async () => {
    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    return buildClient(MarketplaceClient).getRegistry()
  })

  server.handle(RPC_CHANNELS.marketplace.INSTALL_SKILL, async (_ctx, workspaceId: string, skillName: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const files = await buildClient(MarketplaceClient).getSkillFiles(skillName)
    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillName)
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true })
    for (const file of files) {
      const filePath = join(skillDir, file.path)
      const dir = dirname(filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, file.content, 'utf-8')
    }
    deps.platform.logger?.info(`MARKETPLACE_INSTALL: Installed ${skillName} (${files.length} files) to ${skillDir}`)
  })
}
```

- [ ] **Step 2: 加 handler 单测（有/无身份两路）**

```ts
// packages/server-core/src/handlers/rpc/__tests__/marketplace.test.ts
// mock '@craft-agent/shared/config' getCvteIdentity → 验证 GET_REGISTRY 构造的 client 带/不带 account
```
（按本仓 handler 测试既有 mock 风格编写；断言注册了且仅注册 GET_REGISTRY+INSTALL_SKILL 两个 channel。）

- [ ] **Step 3: 编译 + 跑测试**

Run: `bun run typecheck:all && cd packages/server-core && bun test src/handlers/rpc/__tests__/marketplace.test.ts`
Expected: typecheck 可能因 channels/preload 仍引用 LOGIN/LOGOUT/AUTH_STATUS 而报错 → 由 Task 5 收口；本步至少 handler 单测 PASS

- [ ] **Step 4: 提交**

```bash
git add packages/server-core/src/handlers/rpc/marketplace.ts packages/server-core/src/handlers/rpc/__tests__/marketplace.test.ts
git commit -m "feat(marketplace): handler 用持久化门户身份鉴权，删 login/logout/authStatus"
```

---

## Task 5: 删 OAuth 窗 + 平台装配 + LOGIN/LOGOUT/AUTH_STATUS 契约

**Files:**
- Delete: `apps/electron/src/main/marketplace-auth.ts`
- Modify: `apps/electron/src/main/platform.ts`、`packages/server-core/src/runtime/platform.ts`（去 `marketplaceAuth`）
- Modify: `packages/shared/src/protocol/channels.ts`（删 `marketplace.LOGIN/GET_AUTH_STATUS/LOGOUT`）
- Modify: `packages/shared/src/protocol/routing.ts`（删这三个 channel 的 LOCAL_ONLY 路由项）
- Modify: `apps/electron/src/transport/channel-map.ts`（删 `loginMarketplace/getMarketplaceAuthStatus/logoutMarketplace`）
- Modify: `apps/electron/src/shared/types.ts`（删这三个方法签名）
- Modify: `apps/electron/src/preload/bootstrap.ts`（删暴露，若有）

- [ ] **Step 1: 删文件 + 摘除三处 channel/方法**

```bash
git rm apps/electron/src/main/marketplace-auth.ts
```
删除 `channels.ts` 中 `marketplace` 对象里的 `LOGIN/GET_AUTH_STATUS/LOGOUT` 三行（保留 `GET_REGISTRY/INSTALL_SKILL`）；`routing.ts` 删这三个 channel 的路由登记（保留另两个 LOCAL_ONLY）；`channel-map.ts` 删 `loginMarketplace/getMarketplaceAuthStatus/logoutMarketplace`（保留 `getMarketplaceRegistry/installMarketplaceSkill`）；`shared/types.ts` 删对应签名；`platform.ts`(两处) 去掉 `marketplaceAuth` 装配与类型。

- [ ] **Step 2: 全量编译**

Run: `bun run typecheck:all`
Expected: PASS（残余引用应全部消除；若 SkillsListPanel 仍引用 loginMarketplace → 留给 Task 6，可暂时编译失败于 renderer，本步聚焦 main/shared/server-core 通过）

- [ ] **Step 3: 守护测试**

Run: `bun test`（运行 ipc-channels / registration / routing 守护测试）
Expected: 这些测试断言的 channel 集合需同步更新为不含 LOGIN/LOGOUT/AUTH_STATUS；更新断言后 PASS

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(marketplace): 删 OAuth 登录窗与 login/logout/authStatus 契约"
```

---

## Task 6: SkillsListPanel 登录动作改触发门户 SSO

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx`

- [ ] **Step 1: 改 `handleMarketplaceLogin` 调门户 SSO**

把原 `await window.electronAPI.loginMarketplace()` 改为现有门户 SSO 触发（与设置页一致）：

```ts
const handleMarketplaceLogin = useCallback(async (onDone?: () => void) => {
  const id = toast.loading(t('marketplace.loggingIn'))
  try {
    const r = await window.electronAPI.startCvtePortalOAuth()  // 现有 SSO，成功后已持久化身份
    if (r?.success) {
      toast.success(t('marketplace.loginSuccess'), { id })
      onDone?.()
    } else {
      toast.error(t('marketplace.loginFailed'), { id, description: r?.error })
    }
  } catch (e) {
    toast.error(t('marketplace.loginFailed'), { id, description: e instanceof Error ? e.message : undefined })
  }
}, [t])
```

> 执行注意：`startCvtePortalOAuth` 的实际方法名/返回形以 `apps/electron/src/shared/types.ts` 与 AiSettingsPage 调用为准（`grep -rn startCvtePortalOAuth apps/electron/src`）。安装时 401→`isMarketplaceAuthError` 弹「登录」action（已有逻辑）→ 调本函数；登录成功 `onDone` 自动重试安装。

- [ ] **Step 2: 移除 authStatus 相关用法**

删除 SkillsListPanel 中任何 `getMarketplaceAuthStatus`/`logoutMarketplace` 调用与相关 state（若有；浏览不需要 authStatus，安装失败由 401 驱动引导）。

- [ ] **Step 3: 编译**

Run: `bun run typecheck:all`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx
git commit -m "feat(marketplace): 未登录安装→提示并触发门户 SSO(复用持久化身份)"
```

---

## Task 7: i18n 收口

**Files:**
- Modify: `packages/shared/src/i18n/locales/*.json`（7 个）

- [ ] **Step 1: 核对 marketplace.* key 齐全**

revert 已恢复 `marketplace.{authRequired,login,loggingIn,loginSuccess,loginFailed,unreachable,loadFailed,installFailed}` 等 key。确认所有 locale 含这些 key（parity）。若 Task 6 文案有增减，按 `packages/shared/CLAUDE.md` i18n 规则同步全部 locale（字母序、parity、coverage）。

- [ ] **Step 2: i18n 门禁**

Run: `bun run lint:i18n:sorted && bun run lint:i18n:parity && bun run lint:i18n:coverage`
Expected: 全部 PASS

- [ ] **Step 3: 提交（如有改动）**

```bash
git add packages/shared/src/i18n/locales/
git commit -m "chore(i18n): 市场重新集成文案 parity 收口"
```

---

## Task 8: 端到端验证（运行态取证）

**Files:** 无（验证）

- [ ] **Step 1: 全量编译 + 测试 + i18n 门禁**

Run: `bun run typecheck:all && bun test && bun run validate:ci`
Expected: 全 PASS

- [ ] **Step 2: 构建 + CDP 沙箱冒烟（[[e2e-sandbox-playbook]]）**

按 e2e 沙箱手法启动打包/dev app（隔离 HOME、单实例、NO_PROXY 含 `.gz.cvte.cn`），经 CDP 验证三条：
1. **无身份浏览**：打开技能面板 → 市场列表加载成功（`/api/registry` 开放）。
2. **无身份点安装**：toast 提示「需登录」+「登录」action（不静默失败）。
3. **注入身份后安装**：`setCvteIdentity({account:'luoxiaowei',email:'luoxiaowei@cvte.com'})`（或真实门户 SSO）后点安装 → 200 → 技能落入工作区 skills 目录（含 `SKILL.md`）。

证据：CDP 截图 + 列表项数 + 安装后 `ls <workspace>/skills/<name>`。

- [ ] **Step 3: 完成开发分支**

REQUIRED SUB-SKILL：使用 superpowers:finishing-a-development-branch 收口（决定合并/PR/保留）。

---

## Self-Review 记录

- **Spec 覆盖**：鉴权换 header(T1)、身份来源 SSO(T2/T3)、handler 适配(T4)、删 OAuth(T5)、未登录 UX(T6)、i18n(T7)、验证(T8) —— 全覆盖设计各节。
- **类型一致**：`MarketplaceClientOptions.{account,email}`、`StoredConfig.cvteIdentity`、`get/setCvteIdentity`、`CvtePortalIdentity` 全程一致。
- **占位检查**：无 TBD；少数"定位现有落点"为读后精确插入指定代码，非占位。
- **风险**：`startCvtePortalOAuth` 方法名以现网类型为准（T6 已给定位命令）；revert 后 `package.json` 版本需复位（T0 Step2）。
