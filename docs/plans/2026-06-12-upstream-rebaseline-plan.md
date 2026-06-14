# 上游重基线执行计划（v0.4.8 → v0.10.3）

**日期：** 2026-06-12
**输入：** `docs/CUSTOMIZATIONS.md`（定制登记册，决策 D1–D7 与移植清单的唯一事实源）
**目标：** 以上游 craft-agents-oss v0.10.3 为新基线，重放 CVTE 定制，产出可灰度发布的 `0.10.301`

## Architecture

新基线 = 上游 v0.10.3 原样代码 + 8 个登记定制（CUSTOMIZATIONS.md §二）。后端双引擎格局（ClaudeAgent / PiAgent）不动，CVTE 主路径走 `anthropic` + 网关 baseUrl。所有定制按「配置层 > 引导层 > 独立模块 > agent 核心」的侵入深度排序移植，agent 核心只动 ClaudeAgent 一条链路（决策 D3）。

**Engineering Assessment:** Just right
**Reason:** 范围严格等于登记册清单，无投机性抽象；最重的两项（零配置接入、隔离工作目录）都已通过决策（D3/D6/D7）裁剪到最小必要面；验证门禁复用现有脚本（typecheck/lint/test-ota-flow），不新造框架。

## 前置（M0：基线就绪）

1. `git remote add upstream https://github.com/craft-ai-agents/craft-agents-oss.git && git fetch upstream --tags`（需要网络放行，此前仅用 gh API 探索过）
2. 创建 worktree：`git worktree add .worktrees/rebase-0.10.3 -b cvte/rebase-0.10.3 v0.10.3`
3. 原样构建验证：`bun install && bun run typecheck:all && bun run electron:dev` 跑通 vanilla 上游
4. 旧 `cvte/main` 冻结为维护分支，不再合入新功能

**门禁：** vanilla 上游在 macOS arm64 可启动、可对话（用任意 Anthropic 端点）

## 移植顺序（M1 → M5，按依赖与风险递增）

### M1 配置与品牌（低风险，先让"CVTE 版"能跑）
- 生产日志 + 默认权限 `ask` + workspaceDefaults（§二.8）
- 品牌最小侵入（§二.5，决策 D6）：产品名/图标/appId `com.workagent.app`/数据目录 `~/.workagent/`/deep-link scheme；**逐项核对存量数据连续性**
- 版本号设为 `0.10.301`（决策 D5）
- **门禁：** 安装到有 v0.7.1 数据的机器上，工作区/会话/凭证全部可读

### M2 分发链路（让灰度通道先通）
- OTA fast-update 接入（§二.4）+ 上传脚本 + CI（GitLab）
- macOS Intel 冻结操作落地（决策 D4；先取更新服务器 darwin-x64 占比数据定冻结版本）
- **门禁：** `bun run test:ota` 全流程通过；v0.7.1 测试机经 OTA 升至 0.10.301

### M3 企业零配置接入（§二.1，核心交付）
- config-defaults 企业预配置段 → 默认连接创建 → onboarding 短路 → 隐藏多余提供商 → capabilities.byModel → 401 自愈/离线降级
- SSO 子项：**契约未到前（CUSTOMIZATIONS.md §六 TODO）以接口占位**，先实现"预填 endpoint + 手动粘贴 key"作为降级路径，契约到位后无缝替换
- **门禁：** 全新机器首启 ≤1 次人工输入即进入可对话状态（网关 CVTE-AUTO）

### M4 功能定制
- Skills Marketplace 客户端（§二.3）
- Skill Variables（§二.2，对接新版 claude-agent.ts overlay）
- 迁移助手（§二.7：hooks.json→automations v2、language 字段）
- **门禁：** 带旧 hooks.json/skill vars 的 v0.7.1 数据目录升级后功能等价

### M5 重项与裁决
- 会话隔离工作目录（§二.6，仅 ClaudeAgent 链路，本计划最大单项）
- 3 个待验证项裁决（§三：中断恢复 / AskUserQuestion / 技能自动触发——先在新基线复现场景，证实缺口才移植）
- Windows 捆绑工具裁决（§三：裸机实测后定）
- **门禁：** `bun run typecheck:all && bun run lint && bun test`；macOS arm64 + Windows 双平台打包安装

## 发布（M6）
- `0.10.301` 推 fast-update-server 非默认 channel 灰度 → 收集一周 → `set_latest` 全量
- changelog 经现有 `uploadChangelog` 链路下发，重点提示 automations 迁移

## 风险与回滚
- 每个 M 一个独立 commit 序列，可单独回退
- 灰度期 fast-update-server 保留 v0.7.1 制品；问题时将 latest 指回即整体回滚（appId/数据目录未变，降级可用）
- 最大不确定性：M5 隔离工作目录与上游新 runtime-resolver 的契合度——若超预期，可降级为"仅 artifacts 路由"先发布

## 明确不做（本计划范围外）
- SSO 契约对接实现（等 §六 TODO 补齐后追加）
- 上游 server/webui/messaging 形态的启用
- `openai-responses` 自定义端点补丁（按需再做，候选 PR 回上游）
- 旧 cvte/main 上的任何新功能

---

# 工作分解（WBS）

> 细化日期：2026-06-13。估时为单人净工作日；关键路径 M0→M1→M3→M4→M5→M6，M2 可并行。
> 单人总计约 16–21 天；两人并行约 2.5–3 周。
>
> **执行进度（2026-06-13 终态）：** M0 ✅｜M1 ✅｜M3-MVP+修复批次×5 ✅（零配置/兜底key/D8全路径/取key指引/模型对齐+实测延迟）｜M2.1+M2.2 ✅（OTA 移植+CI 流水线，门禁待 TOKEN/真机）｜M4.1 ✅（marketplace+崩溃修复 72da3644）｜M4.2 核心 ✅（编辑器 UI 待做）｜剩余：M4.2-UI、M2 门禁、M5、M6。
> 实施明细与已知问题见 docs/CUSTOMIZATIONS.md 二-A/B/C；持久记忆锚点：~/.claude projects memory（rebaseline-state）。
>
> **执行纪律（2026-06-13 声明）**：自 M1 起，各里程碑执行遵循 superpowers 流程技能闭环（writing-plans → executing-plans/subagent-driven-development → TDD → verification-before-completion → requesting-code-review），并按任务复杂度匹配 agent 与 model（勘察 Explore+sonnet / 机械移植 sonnet / 架构敏感主线程 / 批量验证 haiku）。

## P0 前置数据与契约（CVTE 侧，立即可启动，与开发并行）

| 项 | 内容 | 解锁 | 估时 |
|----|------|------|------|
| ~~P0.1~~ | ✅ 已决策关闭（2026-06-13）：darwin-x64 冻结于 v0.7.1，不再 OTA（D4） | — | — |
| P0.2 | 抽查存量 `config.json` 的 `llmConnections[].providerType` 分布 | 确认 D3 豁免成立；发现 `openai_compat` 存量则 M4.3 加映射 | 0.5d |
| P0.3 | SSO 契约：换 key REST 端点已提供（CUSTOMIZATIONS.md §六）；仍缺 X-Api-Key 性质、userId 获取方式、SSO 协议 | M3.7 | — |
| ~~P0.4~~ | ✅ 已实测（2026-06-13）：网关已有 `/v1/models`（OpenAI 风格字段，M3 解析小适配） | — | — |

## M0 基线就绪（1d）

- M0.1 `git remote add upstream` + `fetch --tags`；`git worktree add .worktrees/rebase-0.10.3 -b cvte/rebase-0.10.3 v0.10.3`
- M0.2 vanilla 构建启动，**手工配置 CVTE 网关（anthropic + baseUrl）做对话冒烟**——这是全计划最早的风险消除点：第一天就验证网关 × Claude Agent SDK 0.3.170 的真实兼容性（风险 R2）
- M0.3 落点勘察：对 8 个移植项逐一确认在上游新代码中的落点文件（claude-agent.ts 新结构、config-defaults 机制存续、onboarding 流程、runtime 路径解析），产出落点笔记并修正 M1–M5 估时
- **门禁：** vanilla 经 CVTE 网关可对话 + 落点笔记完成

## M1 配置与品牌（2–3d）

- M1.1 config-defaults 值移植（日志/默认权限 ask/隔离目录开关）；若上游无此机制则先移植机制本身（M0.3 确认）
- M1.2 品牌最小侵入：electron-builder（productName/appId `com.workagent.app`/图标）、deep-link scheme、数据目录 `~/.workagent/` 路径常量逐一核对
- M1.3 存量数据 schema 演进核对：v0.4.8 → v0.10.3 的 config.json/preferences.json 差异清单；**确认 `anthropic_compat` providerType 的迁移映射需求（→ M4.3）**
- M1.4 版本号 `0.10.301`；GitLab tag 规范 `v0.10.301-cvte`
- **门禁：** 带 v0.7.1 数据目录启动，工作区/会话/凭证全部可读

## M2 分发链路（2d，与 M3/M4 并行）

- M2.1 auto-update.ts 重放（基于上游新版，吸收 v0.9.6 多窗口状态修复）
- M2.2 upload 脚本 + GitLab CI 双平台流水线（mac arm64 + win x64）
- ~~M2.3~~ 已取消（D4 已决策）：CI 仅构建 mac arm64 + win x64，darwin-x64 不再上传制品，无需任何冻结操作
- M2.4 `bun run test:ota` 全流程 + 真机 v0.7.1 → 0.10.301 OTA 演练
- **门禁：** 真机 OTA 升级成功且数据完好

## M3 企业零配置接入（3–4d）

- M3.1 config-defaults schema 扩展：enterprise 段（endpoint/默认模型/SSO 地址）
- M3.2 首启默认连接初始化（检测 → 创建 connection → credential manager 写入）
- M3.3 onboarding 短路 + 隐藏 Codex/Copilot/Gemini 等入口
- M3.4 降级路径：预填 endpoint + 手动粘贴 key（SSO 未就绪时的发布形态）
- M3.5 capabilities.byModel + probe 脚本平移
- M3.6 401 自愈 + 网关 SSE 错误透传（network-interceptor）
- M3.7 ⏸ SSO 登录 + REST 换 key（**被 P0.3 阻塞**；以 KeyProvider 接口占位，契约到位后实现，不阻塞发布）
- **门禁：** 全新机器首启 ≤1 次人工输入进入可对话状态

## M4 功能定制（3–4d）

- M4.1 Skills Marketplace 客户端平移
- M4.2 Skill Variables 对接新版 claude-agent.ts overlay + `bun test` 回归
- M4.3 迁移助手：hooks.json → automations v2 转换器；preferences language 字段；**`anthropic_compat` → `anthropic` 连接映射**；（视 P0.2 结果）`openai_compat` → `pi_compat`
- **门禁：** 带旧 hooks.json / skill vars / 旧连接的 v0.7.1 数据目录升级后功能等价

## M5 重项与裁决（4–6d，不确定性最大）

- M5.1 三个待验证项各建复现场景（中断恢复 / AskUserQuestion / 技能自动触发，各 0.5d）→ 证实缺口才移植
- M5.2 会话隔离工作目录按上游新架构重实现（仅 ClaudeAgent 链路，2–3d；超期则降级为仅 artifacts 路由）
- M5.3 Windows 裸机实测 → 捆绑工具裁决（视结果 +0–2d）
- M5.4 全量回归：`typecheck:all` + `lint` + `bun test` + 双平台打包安装
- **门禁：** 全部绿 + 双平台真机安装可用

## M6 灰度发布（1d + 1 周观察）

- M6.1 `0.10.301` 推灰度 channel（非 stable）
- M6.2 一周观察：更新服务器错误率、Sentry、用户反馈
- M6.3 `set_latest` 全量 + changelog 经 uploadChangelog 下发（重点提示 automations 迁移）

## 风险登记

| # | 风险 | 消除/兜底 |
|---|------|----------|
| R1 | 存量 `anthropic_compat` 连接类型在新版枚举中不存在 | M4.3 机械映射；M1 门禁覆盖 |
| R2 | CVTE 网关 × SDK 0.3.170 行为变化 | M0.2 第一天冒烟提前烧掉 |
| R3 | 隔离工作目录与上游 runtime-resolver 契合度 | M5.2 降级预案（仅 artifacts 路由） |
| R4 | SSO 契约迟到 | M3.4 降级路径保证可发布；M3.7 滑出不阻塞 |
