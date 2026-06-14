# M1.3 产出：存量数据 Schema 迁移规格（v0.7.1 → 0.10.301）

> 作为 M4.3 迁移助手的实现规格。由 M1.3 子代理对比 cvte/main（v0.4.8 基线）与 v0.10.3 产出，**经 CVTE 决策覆盖修正**（见下）。
> 原始完整对比见会话记录；本文为修正后的执行版。

## ⚠️ CVTE 决策对通用建议的覆盖（最高优先级）

| 子代理原建议 | CVTE 修正 | 依据 |
|-------------|----------|------|
| B-1：迁移数据目录 `~/.workagent` → `~/.craft-agent` | **不迁移**。M1.2 把上游目录常量定回 `~/.workagent`，存量数据原地可用 | D9 |
| B-2：`anthropic_compat` → `pi_compat` | **映射为 `anthropic`**（保留 baseUrl，走 Claude Agent SDK） | D8 |
| B-6：删除 `skill_var::*` 凭证条目 | **保留不删**。M4.2 移植 Skill Variables 后这些凭证继续有效（CVTE 在新基线重新引入 skill_var 凭证类型） | 移植清单 §二.2 |

## 必须迁移（M4.3 实现项，修正后）

| # | 项 | 映射规则 | 实现位置 |
|---|-----|---------|---------|
| 1 | `providerType: 'anthropic_compat'` | → `'anthropic'`（baseUrl 保留） | `storage.ts` loadStoredConfig 迁移链末尾追加 CVTE 步骤（上游已有 `migrateCodexCopilotToPi()` storage.ts:1563、`migrateLegacyProviderTypes()` :2051 可挂靠） |
| 2 | `providerType: 'openai_compat'` | → `'pi_compat'` + `authType: 'api_key_with_endpoint'` + `customEndpoint: {api:'openai-completions'}`（视 P0.2 抽查结果，可能无存量） | 同上 |
| 3 | LlmConnection 已删字段清洗：`capabilities`、`codexPath`、`awsRegion`、`gcpProjectId`、`gcpRegion` | 写入前删除。注意：CVTE 的 `capabilities.byModel` 功能在 M3.5 以新形态重建，旧值是否回灌由 M3.5 决定 | 同上 |
| 4 | `thinkingLevel: 'think'` | → `'medium'`（上游 `normalizeThinkingLevel` thinking-levels.ts:146 已有读时兼容，迁移仅做持久化清洗） | 低优先 |
| 5 | `preferences.language` | → `uiLanguage`，映射 `zh-CN`/`zh` → `zh-Hans`，其余对照 LanguageCode 枚举，无法匹配回退系统语言 | preferences 加载处 |
| 6 | `hooks.json` → `automations.json` | HookMatcher→AutomationMatcher（`hooks`→`actions`，UUID id→6 位 hex，丢弃 workingDirectory/_scheduleId）；PromptHook→PromptAction 兼容 | 新增 `migrateHooksToAutomations()` |
| 7 | `triggeredBy: {type:'schedule',scheduleId,scheduleName}` | → `{automationName: scheduleName, event: 'schedule'}` | sessions 读取处 |
| 8 | 安全丢弃项（读不报错，写时自然消失）：SessionHeader 的 `runtimeDirectory/remoteRoomId/remoteUrl/parentSessionId/siblingOrder`、`StoredConfig.openaiVariant`、`WorkspaceConfig.defaults.isolateSessionDirectory` | 无需代码，登记知悉 | — |

## 需人工决策（剩余项）

| # | 项 | 建议 | 状态 |
|---|-----|------|------|
| C-1/2/3 | 存量 `openai`/`bedrock`/`vertex` 连接处置 | 待 P0.2 抽查；预期 CVTE 部署无此类存量，若有→删除并提示重配 | ⏳ P0.2 |
| C-4 | 旧 command 型 hook 无新版对应（automations 仅 Prompt/Webhook） | 待 P0.2 顺带抽查 hooks.json 使用情况；预期极少，丢弃 + 提示 | ⏳ |
| C-5 | `pendingPlanExecution` 进行中会话 | 迁移时清空该字段（放弃进行中 plan，避免重复执行），影响面极小 | ✅ 建议即决 |
| C-7 | language 自由文本兜底 | 见必迁 #5 的映射规则 | ✅ 已并入 |

## 兼容无需迁移（要点）

- 全局设置字段、Workspace 基础字段、permissions.json 核心字段、SessionHeader 主体字段、credential 序列化格式（`anthropic_api_key::global`、`source_*::ws::slug` 等）均不变，旧 JSONL 可直读
- 新版新增可选字段（slug/remoteServer/blockedCommandHints/thinkingLevel 等）旧数据缺失不影响加载
