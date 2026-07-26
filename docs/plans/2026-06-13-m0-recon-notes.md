# M0.3 落点勘察笔记（上游 v0.10.3）

**勘察对象：** `.worktrees/rebase-0.10.3`（vanilla v0.10.3）
**日期：** 2026-06-13
**作用：** 8 项移植定制在新基线中的落点确认；修正 WBS 估时与设计假设

## 改写计划假设的三个发现

### F1 ⚠️ 上游会把「anthropic + 自定义 baseUrl」自动切到 Pi 后端（影响 D7 设计）

`packages/server-core/src/domain/connection-setup-logic.ts:134-168` + `handlers/rpc/llm-connections.ts:78-89`：
`anthropic-api` 模板在 baseUrl 非空时自动改为 `providerType: 'pi_compat'` + `customEndpoint: {api: 'anthropic-messages'}`，即**走 PiAgent 而非 Claude Agent SDK**。

但 anthropic driver 本身仍支持 baseUrl（`drivers/anthropic.ts:28`），即直接构造 `providerType: 'anthropic'` + baseUrl 的连接对象在引擎层是可行的，只是标准 setup 流程不这么建。

**→ D8 已决策（2026-06-13）：路线 A —— `anthropic` + baseUrl（Claude Agent SDK）**，与 CVTE 现状语义一致；连接由零配置接入逻辑自建，绕过上游 setup 的 pi_compat 自动切换。M0.2 冒烟只验路线 A。

### F2 ✅ 会话隔离工作目录上游疑似已原生实现（M5.2 可能大幅缩水）

`packages/shared/src/sessions/storage.ts:200-212`：`createSession()` 中 `sdkCwd = workingDirectory ?? getSessionPath(...)`——**默认 SDK cwd 就是 per-session 目录**，且 `{{SESSION_PATH}}` token、session 子目录结构（plans/attachments/data/downloads）齐备。
**→ M5.2 从「重实现（2-3d）」降为「行为验证 + 差距补齐（artifacts 路由细节、sidecar 展示）」，预估 0.5-1.5d**

### F3 上游废弃了 SDK plugins 机制（影响 Skill Variables 实现形态）

`claude-agent.ts:1355-1357`：`plugins: []`，skills 改为 BaseAgent.chat() 的 read-before-execute 模式。
**→ Skill Variables 不再需要旧的「临时 overlay 目录」方案**；替换落点改为 BaseAgent 注入 skill 内容处的字符串变换。需在 M4.2 确认：若 Claude 也会直接 Read 磁盘上的 SKILL.md，则仍需落盘替换（写入替换后的副本目录）

## 各项落点速查

| 项 | 判定 | 落点 | WBS 修正 |
|----|------|------|---------|
| config-defaults | 同款存在 | `resources/config-defaults.json` + `config/storage.ts:101-210`（注意用户目录已改 `~/.craft-agent/`，品牌项需核对） | M1.1 改值即可 |
| onboarding 短路 | 现成 hook | `auth/state.ts:332-346` `getSetupNeeds()`；连接非空即跳过向导；提供商列表在 `ProviderSelectStep.tsx` PROVIDER_OPTIONS | M3.3 按预期 |
| LLM 连接创建 | API 重构 | `SETUP_LLM_CONNECTION` IPC（`server-core/handlers/rpc/llm-connections.ts:52`）；credential 经 `manager.setLlmApiKey(slug, key)`（slug 命名空间，旧版 `anthropic_api_key::global` 已废弃） | M3.2 注意 credential id 形态迁移 |
| auto-update | 同款 electron-updater | feed 仅由 `electron-builder.yml:79` publish.url 驱动 | M2.1 diff 面比预期小；CVTE 的 check/changelog/429 重试逻辑按需重放 |
| network-interceptor | 已改 unified、**Pi-only** | `unified-network-interceptor.ts:1821 captureApiError()`；Claude SDK 0.2.113+ 原生二进制无法 preload | 401 自愈分叉：Pi 路线挂 interceptor；anthropic 路线在 claude-agent 错误链挂（与 D8 联动） |
| automations v2 | 完整 | `automations/types.ts` + `schemas.ts`（Zod）；事件名与旧 hooks 高度对应 | M4.3 转换器目标格式明确 |
| uiLanguage | — | `config/preferences.ts:41`，语言码 **zh-Hans**（非 zh-CN） | M4.3 迁移映射 zh-CN→zh-Hans |
| i18n | zh-Hans 内置 | `i18n/registry.ts`（7 语言，CI 有 parity check：新增 key 须补全 7 个 locale） | CVTE 专有 UI 文案成本↑ 一点 |
| marketplace | 缺失 | 安装 = 向 `GLOBAL_AGENT_SKILLS_DIR`（`~/.agents/skills/`）写 SKILL.md | M4.1 旧 client.ts 平移 + 写盘逻辑 |
| 数据目录 | ⚠️ 上游已改 `~/.craft-agent/` | 旧版是 `~/.workagent/` | M1.2 品牌项必须把目录定回 `~/.workagent/`（存量数据连续性红线） |

## 新增/修正的风险

| # | 内容 | 处置 |
|---|------|------|
| R5 | D8 引擎路线未定（F1） | M0.2 双路线冒烟后裁决，写回 CUSTOMIZATIONS.md |
| R6 | 上游用户目录改为 `~/.craft-agent/`，与 CVTE 存量 `~/.workagent/` 不同 | M1.2 强制核对项；M1 门禁已覆盖 |
| R7 | i18n 语言码 zh-Hans vs 存量配置 zh-CN | M4.3 迁移映射一行 |
