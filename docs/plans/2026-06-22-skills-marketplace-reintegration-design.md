# 重新集成 skills.gz.cvte.cn 技能市场（新 header 鉴权）设计

> 类型：**revert + 鉴权适配**。先前提交 `b43d2d93`（+`fef3121c`）整体移除了 in-app 技能市场（改走 cskills CLI）；现 skills.gz.cvte.cn 提供了**更简单的 header 鉴权**，恢复 in-app 市场重新有价值。本设计经 brainstorming 与用户对齐后产出，下一步交 writing-plans 出实现计划。

## Context（为什么做）

- **当时为何移除**：旧 in-app 市场依赖 BrowserWindow OAuth + cookie 登录（`marketplace-auth.ts` 139 行），上游冲突面大、登录链路重，战略上改走 cskills CLI（提交 `b43d2d93`/`fef3121c`，2026-06-14）。
- **为何现在恢复**：skills.gz.cvte.cn 推出新接入——只需两个请求头 `X-CSkills-User-Account` / `X-CSkills-User-Email`，**无需 OAuth 窗口**。重做成本骤降，且 in-app 浏览/一键安装体验优于 CLI。
- **目标**：复用被移除的旧 UI/客户端/RPC，把鉴权从 cookie 换成 header，身份复用 CVTE 门户 SSO。

## 实测契约（事实源，2026-06-22 真机验证）

| 端点 | 无 header | 带 header | 形状 |
|------|----------|----------|------|
| `GET /api/registry`（浏览，旧） | 200 | 200 | `{version, updatedAt, skills[], groups}` —— **与旧 `MarketplaceRegistry` 兼容**（新增 `groups`，忽略即可） |
| `GET /api/skills`（浏览，新） | 200 | 200 | `{data[], total, updatedAt}`；item 含 `id/name/displayName/description/author:{name}/tags/compatibility/version/updatedAt/likes/downloads/views` |
| `GET /api/skills/{name}/files`（详情/安装） | **401** | 200 | `{name, files:[{path, content}]}` —— **与旧 `MarketplaceSkillFile[]` 完全一致** |

- **鉴权模型**：浏览开放，详情/安装需 header。实测 `X-CSkills-User-Account` 必需、`X-CSkills-User-Email` 可省；按契约两个都发更稳。
- **结论**：旧客户端的端点与错误分类（401→需登录）原样适用；唯一变化是凭证从 `Cookie` 改为两个 header。`/api/registry` 仍可用，故旧数据模型不必改（`/api/skills` 的富字段为可选增强，本期不引入）。

## 架构

`git revert b43d2d93`（实测**零冲突**，仅 `package.json` 版本行需复位回 0.10.316）恢复全部市场代码，再做三处外科改动：

1. **客户端换鉴权** —— `packages/shared/src/marketplace/client.ts`
   - `MarketplaceClientOptions`：`cookie?` → `account?` + `email?`。
   - `headers()`：发 `X-CSkills-User-Account`/`X-CSkills-User-Email`，不再发 `Cookie`。
   - 端点、`isMarketplaceConnectivityError`/`isMarketplaceAuthError`/`throwForStatus`（401/403→`MARKETPLACE_AUTH_REQUIRED`）原样保留。

2. **身份持久化 + 注入**
   - portal SSO 成功回调（relay 已返回 `identity:{account,name,email,simUid}`）→ 把 `{account,email}` 落 `config.json`（非密、明文 OK；新增 `cvteIdentity?:{account,email}` 字段 + getter/setter）。
   - 市场 RPC handler（`packages/server-core/src/handlers/rpc/marketplace.ts`）读该身份构造 `MarketplaceClient`。

3. **删 OAuth 窗、改登录入口**
   - 删 `apps/electron/src/main/marketplace-auth.ts`（BrowserWindow OAuth）+ `marketplace:login/logout` RPC + channel + `persist:cvte-portal` cookie 机制。
   - 旧 UI 的"登录市场"affordance → **触发现有 portal SSO**（顺带持久化身份）。

## 数据流

```
浏览：SkillsListPanel → marketplace:getRegistry → /api/registry(开放) → 渲染列表
安装：点安装 → marketplace:getSkillFiles(name)
        → handler 读持久化 account/email → 发 header → /api/skills/{name}/files
        → 200：写入技能目录（旧安装逻辑原样） / 401：UI 引导
未登录点安装：401 → 弹提示「请先完成 CVTE 门户登录」+ 一键触发 portal SSO
        → SSO 成功持久化身份 → 自动/重试安装
```

## 待改/恢复文件（代表）

- **revert 恢复**：`marketplace/{client,types,index}.ts`、`server-core/handlers/rpc/marketplace.ts`、`SkillsListPanel.tsx`（市场 UI）、`protocol/{channels,routing}.ts`、`transport/channel-map.ts`、`shared/types.ts`、i18n ×7、`network-proxy.ts`。
- **改鉴权**：`marketplace/client.ts`（cookie→header）、`marketplace/client.test.ts`（断言改 header）。
- **身份持久化**：`packages/shared/src/config/storage.ts`（`cvteIdentity` 字段）+ config getter/setter；portal SSO 完成处（server-core 的 `cvte:completeOAuth`/resolve-key 落库点）写入。
- **删除**：`apps/electron/src/main/marketplace-auth.ts` + login/logout RPC/channel/preload 暴露。
- **登录入口**：`SkillsListPanel.tsx` 的登录 affordance → 调用现有 `startCvtePortalOAuth`。
- **复用**：portal SSO 全链路、技能安装写盘、错误分类与 i18n、proxy 旁路（`.gz.cvte.cn` 已覆盖 skills 域，无需改）。

## 错误处理 / 边界

- 市场不可达 → `MARKETPLACE_UNREACHABLE`（旧友好文案）。
- 详情/安装 401 → `MARKETPLACE_AUTH_REQUIRED` → 弹提示 + 触发 SSO。
- 身份缺失 → 浏览正常；安装引导登录（不静默失败）。
- email 可缺：account 必发，email 有则发。

## 测试

- **client 单测**（mock fetch）：header 注入（account/email）、401→AUTH_REQUIRED 分类、不可达→UNREACHABLE（恢复旧 `client.test.ts` 并改鉴权断言）。
- **handler 单测**：有/无持久化身份两路构造 client。
- **CDP 沙箱冒烟**（[[e2e-sandbox-playbook]]）：① 无身份浏览列表正常 ② 无身份点安装见登录引导 ③ 注入身份后安装成功、技能落盘。
- 三包 typecheck + i18n parity 门禁。

## Engineering Assessment

**Just right** —— 复用经 review 的成熟旧实现（revert 干净恢复），仅一处鉴权外科适配 + 一个 config 身份字段；无新抽象、无为未来预留的可配置项。唯一新增逻辑是身份持久化（必需，否则 header 无来源）。

## 外部 / 生产前项（非本期实现）

- 旧 UI 文案/术语沿用；如 skills.gz 改用 `/api/skills` 富字段（likes/downloads）再单独增强。
- 生产环境 account/email 一律来自门户 SSO 真实身份；不内置任何默认账号。

## 实现纪律

- 按 CLAUDE.md：在专用 worktree 执行（`git worktree add .worktrees/feat/skills-marketplace-reintegration -b feat/skills-marketplace-reintegration`，基于 `cvte/rebase-0.10.3-rc`）。
- 下一步：交 writing-plans 出分步实现计划。
