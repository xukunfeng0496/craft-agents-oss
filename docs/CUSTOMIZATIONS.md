# CVTE 定制登记册（CUSTOMIZATIONS.md）

> 本文档是 CVTE fork 相对上游 [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss) 的**唯一定制事实源**。
> 每一处对上游文件的侵入式修改都必须在此登记；重基线/同步上游时以本清单为执行依据。
>
> 盘点基准：2026-06-12 | 分叉点 `f618a0f`（上游 v0.4.8，2026-02-17）| cvte/main 当前 v0.7.1（222 提交 / 919 文件）| 上游目标基线 v0.10.3

---

## 一、关键决策记录

| # | 决策 | 说明 |
|---|------|------|
| D1 | **重基线策略**（非逐版本 merge） | 上游每版本一个 squash 提交、v0.5.0 重写后端层（Codex/Copilot → Pi SDK），文本合并语义失效；以上游 v0.10.3 为新基线重放定制 |
| D2 | **桌面端保留** | 上游 Electron 桌面端仍是旗舰形态（apps/ = cli, electron, viewer, webui），服务端/消息网关为可选附加，无需部署 |
| D3 | **Codex/Copilot 不迁移、可选隐藏** | CVTE 部署走统一网关（anthropic + baseUrl → Claude Agent SDK，上游此路径原封不动）；`openai`/`copilot` 类型连接为旁路。需抽查存量 `config.json` 的 `llmConnections[].providerType` 确认无人使用 |
| D4 | **macOS Intel 终止 OTA**（已决策 2026-06-13） | darwin-x64 客户端冻结于 v0.7.1，后续不再提供 OTA 迭代。fast-update-server 不再接收 darwin-x64 制品与 `set_latest`，零代码零运维；后续所有计划不再考虑 Intel |
| D5 | **版本号方案：补丁位 ×100** | CVTE 版本 = `X.Y.(Z×100+n)`，如上游 0.10.3 → CVTE 0.10.301、0.10.302。合法 semver、electron-updater 零改造、与上游 tag 永不碰撞、可读出基线。**禁用** build metadata（`+cvte.N` 在 semver 比较中被忽略，迭代间无法触发更新） |
| D6 | **品牌最小侵入** | 保留对用户可见的：产品名、appId（`com.workagent.app`，**OTA 原地升级强依赖，不可变**）、数据目录 `~/.workagent/`、deep-link scheme。**放弃**内部包名重命名（`@craft-agent/*` → `@work-agent/*` 是 919 文件 diff 的最大噪声源，对用户不可见） |
| D7 | **CVTE 网关替换官方默认 endpoint** | 走「企业零配置接入」（见 §二.1），api_key 经 SSO 身份从 CVTE REST API 按人换发 |
| D8 | **网关引擎沿用 Claude Agent SDK**（已决策 2026-06-13） | 连接构造为 `providerType: 'anthropic'` + `baseUrl`，**绕过**上游 setup 流程对自定义 baseUrl 自动切 `pi_compat` 的行为（连接由零配置接入逻辑自建，不走标准向导）。401 自愈挂 claude-agent 错误链（上游 unified-network-interceptor 为 Pi-only，对此路线不可用） |
| D9 | **数据目录保持 `~/.workagent/`**（已决策 2026-06-13） | 0.10.301 用 1–2 行补丁把上游 `~/.craft-agent/` 常量定回 `~/.workagent/`（归 D6 品牌桶），不与重基线同车做数据迁移。向上游目录的迁移（rename + symlink/junction 兜底方案）列为可选后续独立小版本 |
| D10 | **旧全局技能首启自动搬迁**（已决策 2026-06-13） | 上游把全局技能目录迁到 `~/.agents/skills`（#171），存量 CVTE 用户的 `~/.workagent/skills`（20+）新版不读会"消失"。首启幂等搬迁：**复制**（保留原目录作备份）、**不覆盖**新目录同名 slug、CONFIG_DIR 标记位一次性、fail-soft 不阻塞启动。实现 `skills/migrate-skills-dir.ts`，main `whenReady` 调用 |
| D11 | **会话分享改指内网 viewer / 默认禁用外发**（已决策 2026-06-13） | 上游"分享会话"把整段 transcript POST 到公网 `agents.craft.do`（企业内部数据外流）。改为 `enterprise.viewerUrl` 可配：企业版**配了**→走内网 viewer；企业版**没配**→`resolveViewerUrl()` 返回 null、**分享直接禁用**（杜绝默认外流）；非企业版→保留 craft.do。SessionManager 4 处调用全部改道。**内网 viewer 部署 + URL 为待补外部契约（§六）** |

---

## 二、保留移植清单（8 项，Phase 2 执行范围）

### 1. 企业零配置接入 ⭐ 新设计（取代旧「CVTE-AUTO 网关适配」+「SSO 设计」，吸收「网关错误展示」）

**流程**：首启读 config-defaults 企业预配置段 → 系统浏览器 SSO 登录（loopback 回调，复用 `packages/shared/src/auth/` 现有 OAuth 模式）→ 调 CVTE REST API 换发个人 api_key → 写入 credentials.enc → 自动创建默认连接（`anthropic` + 网关 baseUrl + CVTE-AUTO）→ 跳过 onboarding。

| 子项 | 成本 | 说明 |
|------|------|------|
| config-defaults 企业预配置段（endpoint/模型/SSO 地址） | 低 | 扩展现有 `resources/config-defaults.json` 机制（schema 见 `packages/shared/src/config/config-defaults-schema.ts`）。**默认 endpoint 已确定（2026-06-13）：`https://token.cvte.com`** |
| SSO 登录流程 | 中 | ⚠️ **TODO：等 CVTE 侧补充契约**（见 §六） |
| REST API 换发 key + 写 credentials.enc，**含兜底 key**（2026-06-13 决策：取不到用户个人 key 或用户无 key 时，回退使用默认兜底 key） | 低 | key 绝不明文落盘；明文来源用后即焚。兜底 key 的分发方式待定（烘焙 vs 预配置文件），按"已暴露"假设设计网关侧配额/审计 |
| 默认连接创建 + onboarding 短路 + 隐藏 Codex/Copilot/Gemini 等入口 | 低 | — |
| 401 自愈（静默重换发/重拉 SSO）+ 离线降级 | 低 | 挂 network-interceptor 错误链；含原「网关错误展示增强」（SSE 错误透传，~43 行） |
| capabilities.byModel 能力覆盖 + probe 脚本 | 低 | 平移；`scripts/model-capability-probe.ts` / `model-capability-patch.ts` 可复用 |

**长期优化**：网关侧实现 `/v1/models`（上游 anthropic driver 原生拉取，`drivers/anthropic.ts:50`），模型列表自动填充，免硬编码。

**旧实现参考**：`packages/shared/src/config/models.ts`、`model-capability-report.ts`、`docs/model-capability-ops.md`、`docs/plans/2026-03-01-sso-integration-design.md`

### 2. Skill Variables（技能变量）

SKILL.md frontmatter 声明 `vars`，UI 填值加密存储，运行时 `{{VAR}}` 替换经临时 overlay 以最高优先级 plugin 注入 SDK。**上游无等价物，有贡献回上游潜力。**

- 成本：中（overlay 刷新逻辑需对接上游新版 `claude-agent.ts`）
- 旧实现：`packages/shared/src/skills/vars-{processor,storage,substitution}.ts`、`packages/shared/src/prompts/skill-variables-context.ts`
- 文档：`docs/plans/2026-02-26-skill-variables-design.md` 等 4 篇

### 3. Skills Marketplace 客户端

从 `https://skills.gz.cvte.cn` 拉取 registry，列表/搜索/预览/一键安装。当前匿名访问；SSO 落地后可升级为按人发布/审计（与 §二.1 共享身份基建）。

- 成本：低（纯 REST + UI，与 agent 后端零耦合）
- 旧实现：`packages/shared/src/marketplace/{client,types}.ts`、`SkillsListPanel.tsx` 扩展
- 文档：`docs/plans/2026-03-01-marketplace-system-design.md`

### 4. OTA fast-update-server 接入

自托管更新源（替代 GitHub Releases）、静默下载/退出安装、429 重试、上传脚本、OTA 测试脚本。

- 成本：低（纯 Electron updater 层）；注意吸收上游 v0.9.6 多窗口状态保存修复
- 旧实现：`apps/electron/src/main/auto-update.ts`（+349 行）、`scripts/upload-fast-update-release.ts`、`scripts/test-ota-flow.ts`
- 文档：`docs/plans/2026-03-20-ota-testing-plan.md`

### 5. 品牌（按 D6 最小侵入重做）

产品名/图标/appId/数据目录/deep-link scheme；不再重命名内部包。

- 成本：中→低（相比旧方案大幅缩水）
- ⚠️ appId 与数据目录是存量用户 OTA/数据连续性的生命线，重基线版本必须逐项核对

### 6. 会话隔离工作目录（仅 ClaudeAgent 链路）

每会话独立运行目录 + artifacts 路由到专属 output 文件夹 + sidecar 实时展示。

- 成本：**高 ★★☆**（原 ★★★，因 D3 豁免 codex/copilot 链路降级）；需按上游新架构重新实现 base-agent/claude-agent 的目录传递
- 旧实现：`packages/shared/src/sessions/runtime-paths.ts`、`storage.ts`、`jsonl.ts`、`apps/electron/src/main/sessions.ts`
- 上游相关可借力：`{{SESSION_PATH}}` 可移植 token（v0.7.4）、per-workspace 工作目录历史（v0.7.7）
- 文档：`docs/plans/2026-02-19-session-isolated-working-directory.md`

### 7. 首启迁移助手 ⭐ 新增项

存量 v0.7.1 客户端 OTA 到新基线后的体验保障：

- 检测旧 `hooks.json` → 自动转换为 `automations.json` v2（上游 v0.5.1 Breaking，无官方自动迁移）
- 检测 `preferences.json` 旧 `language` 字段 → 映射到 uiLanguage（v0.8.5/v0.10.1 Breaking）
- ~~Codex/Copilot 连接重配引导~~（D3 豁免，仅在抽查发现存量时补 `openai_compat` → `pi_compat` 机械迁移）
- 成本：低-中

### 8. 生产日志 + 默认权限模式

生产包文件日志（info 级，5MB）；默认权限 `ask`；`isolateSessionDirectory: true` 等 workspaceDefaults。

- 成本：极低（`resources/config-defaults.json` 数值 + logger 配置，~15 行）

---

## 二-A、M1 实施记录（2026-06-13，分支 cvte/rebase-0.10.3）

| 改动 | 落点 | 备注 |
|------|------|------|
| 上游缺陷修复：补 `tsconfig.base.json` | 仓库根（新文件） | 上游漏提交导致 3 包 typecheck 必挂；候选 upstream PR |
| defaults：permissionMode `ask`、cyclable `[ask,safe,allow-all]`、描述改 Work Agents | `apps/electron/resources/config-defaults.json` | isolateSessionDirectory 字段上游已删，未加（M5 处理） |
| 生产文件日志（info 级 5MB JSON）+ `getLogFilePath()` 改按 transport 判定 | `apps/electron/src/main/logger.ts` | — |
| 数据目录 `.craft-agent` → `.workagent` 全量替换 | **64 个文件**（D9 的"1-2 行"假设证伪：上游有 ~20 处独立 `join(homedir(),...)` 字面量散落） | ⚠️ 加密盐 `craft-agent-v2`（无点前缀）未动也绝不能动；**需 CI 哨兵 grep 防上游同步回归**（待加） |
| deeplink scheme `craftagents` → `workagents` | 29 个文件（含 OAuth 回调、url-safety 白名单、测试；另修大写变体 `CRAFTAGENTS` 1 处） | i18n key 名（menu.aboutCraftAgents 等）是标识符未改 |
| appId `com.workagent.app`、productName `Work Agents` | `apps/electron/electron-builder.yml` | OTA 原地升级红线已守住 |
| 图标替换（icns/ico/png/svg） | `apps/electron/resources/` | macOS 26 Liquid Glass Assets.car 流水线待 M2 打包时核验 |
| 产品名字符串 `Craft Agents` → `Work Agents` | locale 7 语言 + 31 个代码文件 | 保留 10 处：上游 Docs 服务名 3、package.json 描述 5、dist 产物 2 |
| 版本号 0.10.301 | 根/各包 package.json | D5 方案首次落地 |

**M1 遗留决策项（不阻塞）：** `branding.ts` 的 ASCII "CRAFT" logo（OAuth 回调页可见）；`VIEWER_URL='https://agents.craft.do'`（会话分享上传外部服务，企业数据策略需评估是否禁用/替换）。
**已知问题登记：** 上游 BrowserPaneManager 测试 8 个失败（vanilla v0.10.3 即失败，stash 实证，疑环境相关）。
**门禁证据：** v0.7.1 真实数据副本（隔离 HOME 沙箱）加载 PASS——config/workspace/10 会话/JSONL header 全部可读；`anthropic_compat` 连接原样保留（上游迁移链不处理它，证实 M4.3 必须自映射）；typecheck:all 全绿。

## 二-B、M3/M4.3-MVP 实施记录（2026-06-13，commit d845703d）

| 改动 | 落点 |
|------|------|
| enterprise 段 schema（defaultLlmConnection + hideOtherProviders） | `packages/shared/src/config/config-defaults-schema.ts` |
| enterprise 默认值（cvte-gateway / token.cvte.com / CVTE-AUTO / 6 模型） | `apps/electron/resources/config-defaults.json` |
| `ensureEnterpriseDefaultConnection()`（幂等，仅零连接安装时创建并设默认，midStreamBehavior 'queue'） | `packages/shared/src/config/enterprise-defaults.ts`（新文件），接线于 `apps/electron/src/main/index.ts` createInitialWindows |
| **D8 守卫**：SETUP handler 对 enterprise slug 跳过 pi_compat 自动切换 | `packages/server-core/src/handlers/rpc/llm-connections.ts`（baseUrl 分支加 carve-out） |
| onboarding 短路：唯一未鉴权 anthropic+baseUrl 连接 → 直跳 credentials（editingSlug 复用 + editInitialValues 预填） | `apps/electron/src/renderer/App.tsx` |
| **D8 迁移覆盖**：`anthropic_compat` → `anthropic`（改写上游 migrateLegacyProviderTypes 分支，清洗 capabilities/codexPath） | `packages/shared/src/config/storage.ts` |
| preferences 旧 language 码（zh-CN/zh）→ uiLanguage `zh-Hans` | `packages/shared/src/config/preferences.ts` loadPreferences |

**验证：** 全新安装沙箱预配置 PASS（幂等）；v0.7.1 真实数据迁移 PASS（anthropic+baseUrl 保留+字段清洗）；typecheck:all 绿；i18n parity/sorted 绿。
**新增已知上游缺陷：** `scripts/check-i18n-coverage.ts` 漏提交（同 tsconfig.base.json 性质）。
**MVP 范围外待补（M3 完整版）：** SSO 换 key（等 §六契约）、NO_PROXY 默认、`/v1/models` OpenAI 风格字段解析适配、ProviderSelectStep 的 hideOtherProviders 收窄（当前 Back 仍可见全部提供商）。

### E2E 修复补充（2026-06-13，commit 3c6f847e，CDP 驱动打包产物验证后）

| 修复 | 落点 | 验证 |
|------|------|------|
| **兜底 key**（D7 兑现）：`enterprise.defaultLlmConnection.fallbackApiKey`，连接无 key 时自动回填凭证库（幂等），全新安装零输入可对话。按"已暴露"假设设计，轮换=换 config-defaults | schema + `config-defaults.json` + `enterprise-defaults.ts`（改 async） | 沙箱 PASS |
| **keyless 误判修复**：上游"有 baseUrl 无 key = Ollama 类免 key"启发式对 enterprise slug 豁免，无 key 时正确 `needsCredentials` 进引导 | `auth/state.ts:294` | 删 key 沙箱 PASS |
| **navimaxx 旧端点重写**：任何连接 baseUrl 含 `navimaxx-cc.test.seewo.com` → `https://token.cvte.com`（全 providerType 适用） | `storage.ts` migrateLegacyProviderTypes 循环头 | 真实数据副本 PASS |

**E2E 已证实项：** D8 守卫（setup 带 baseUrl 不翻转 pi_compat）、网关对话（CVTE-AUTO 回复+标题生成）、工具循环（echo→e2e-42）、权限门（ask 模式：只读放行/写操作弹窗/Allow 后真实执行）、存量迁移、zh-Hans UI。

### 批次 2+3 补充（commits 1ec385ff / 9a338e43，用户实测反馈驱动）

| 修复 | 要点 |
|------|------|
| 掩码 key 编辑 bug | 掩码串（`••`）= 保持原 key；TEST handler 兜底拦截（ByteString 崩溃根因） |
| **D8 全路径守卫 + 每启动归一化** | 守卫从 slug 扩为**网关 host**匹配，覆盖 SETUP handler 全部三条变更路径（baseUrl/customEndpoint/无协议降级）；`normalizeCvteGatewayRoute()` 每次启动强制修复 pi_compat 翻车连接 |
| **/v1/models 动态对齐**（用户需求） | anthropic driver 兼容网关 OpenAI 风格条目，**按 `supported_apis` 判定协议**，ctx 取 `max_input_tokens`；一次性迁移 `cvte-gateway-models-1` 切自动同步 |
| **旧 key 自动换兜底** | navimaxx 端点重写打标记 → `ensure()` 一次性替换 stale key（`cvte-gateway-stale-key-replaced-1`），用户后续自定义 key 不被覆盖 |
| cache_control 回归（旧版 `ephemeral.scope` 被拒问题） | **PASS**：捆绑二进制 2.1.170（≥网关要求 2.1.156）；捕获代理实证只发 `{"type":"ephemeral"}`。~~ttl 未验证~~ → **`ttl:'1h'` 已实测网关接受**，extendedPromptCache 可放心开 |
| 品牌补遗 | renderer `<title>`、electron-builder copyright → CVTE |

### 批次 4+5（commits fd26eb44 / ee22e40a / 终批，用户实测闭环）

| 项 | 要点 |
|------|------|
| **上游缺口 #3：Pi 子进程从未被打包** | OSS tag 无任何脚本生成 `resources/pi-agent-server`/`session-mcp-server`（yml 声明了打包意图）→ 所有 OpenAI 协议连接报 `piServerPath not configured`。copy-assets.ts 现场构建装配两个包 |
| D8 归一化收窄 | `openai-completions` 的网关连接尊重用户选择不再强扭；仅修复 anthropic-messages 翻车 + 清洗 anthropic 连接上的 stale `piAuthProvider` |
| 自助取 key 指引 | 认证失败错误卡 + key 输入框下方提示 `https://ai.cvte.com/profile/ai-account`（i18n 7 语言） |
| Agent 自我身份 | 系统提示 "Craft Agent" → "Work Agent"（5 处；`craft_agent_environment` 导入检测标记刻意未动） |
| **用户实测最终结论** | 旧 key（sk-2109）确认无效为根因；个人有效 key + anthropic 路线 + CVTE-AUTO/qwen3.7-plus 全链路可用，**含图像多模态** |

**config.json 审计结论（2026-06-13）：** 连接收敛为 1 条（slug `anthropic-api-2`/显示名 CVTE-CCH，anthropic+token.cvte.com+autoSync ✓）。slug 与显示名不一致属历史遗留——slug 是 credentials.enc 索引键，改动会断凭证关联，**保持现状不动**；`piAuthProvider` 脏字段由归一化自动清洗；`enable1MContext`/`extendedPromptCache` 开关经实测对网关安全。
**遗留 backlog（非阻塞）：** 无效 key 转圈应快速失败（401 自愈项）、权限弹窗按钮 i18n（上游）、credentials.enc 中已删连接的孤儿凭证清理（极低优先）。

## 二-C、M2 + M4 + 观测增强实施记录（2026-06-13 后半场，commits e83771e3..0ea027ff）

| 项 | 要点 | commit |
|------|------|--------|
| **延迟观测双件套** | `scripts/latency-probe.ts`（基线/验收复测，含缓冲判定）；**被动实测**：claude-agent 发 `latency_update` 事件 → SessionManager 中继 → 渲染层 EMA atom（localStorage）→ 模型菜单"实测首字 X.Xs · Y tok/s" | e83771e3 / 35a37+ |
| **网关性能实锤**（已交网关团队三工单） | 直连上游真流式（deepseek TTFT 0.90s）；经 token.cvte.com 全量缓冲且 +2.2s；CVTE-AUTO 路由自身 +2.7s | — |
| **✅ 网关流式修复验收 PASS**（2026-06-13，latency-probe 实测） | 三模型真流式（deepseek TTFT 0.94s/28 块、qwen 1.32s/94 块、AUTO 3.57s/7 块）；**+2.2s 网关延迟同时消失**（deepseek 与直连持平）。剩余工单仅 /v1/models capabilities 字段 | — |
| **M2.1 OTA 移植** | auto-update.ts 三方合并（fast-update 逻辑 × EventSink 广播）；UpdateInfo DTO 扩展；AUTO_UPDATE_* 构建烘焙；**排雷：yml publish.url 从上游 craft.do 改为 CVTE 服务器** | 3a912afd |
| **M2.2 分发流水线** | Actions 工作流（mac arm64-only per D4、win x64、GH Release）；上传脚本适配 `Craft-Agents-{arch}` 命名 + darwin-x64 显式跳过；`/sync-to-fast-update` `/release` 命令移植；发布链 = Actions→GH Release→内网 sync | 10cf0ec6 |
| **M4.1 Marketplace** | 子代理移植到 server-core RPC 体系（双通道+handler+channel-map）；SkillsListPanel 双模式渲染；13 key × 7 locale | c0c1023e |
| **M4.2 Skill Variables 核心** | **新形态**（旧 SDK-plugin overlay 废弃）：vars skill 生成替换后临时副本，read 指令/前置条件指向副本；skill_var 凭证类型恢复（含序列化双向）；旧 9 个测试原样全过。UI 编辑器待做 | 0ea027ff |
| **系统提示 CVTE 化** | `enterprise.promptAppendix` → `## Enterprise Context`（身份/默认中文/数据安全/取 key URL），随版本可更新 | 98c62eb7 |
| **模型富元数据** | enterprise 目录升级为完整 ModelDefinition；driver 按 supported_apis 过滤 + 元数据三级合并；迁移标记 v2 | 98c62eb7 |

**上游 tag 漏提交清单（升至 4 个，提 issue 素材）：** `tsconfig.base.json`、`scripts/check-i18n-coverage.ts`、**pi-agent-server/session-mcp-server 无任何装配脚本**（OpenAI 协议连接打包版必死）、`scripts/check-raw-sends.sh`（lint:ipc-sends 必挂）。
**M2 门禁待办：** 需 FAST_UPDATE_TOKEN + 非 stable 测试频道跑 test:ota；v0.7.1 真机 OTA 演练（含 Squirrel 签名校验验证）。
**M4.2 待办：** ~~vars 编辑器 UI + i18n~~（已于二-D 批次完成，d7932e37）。
**用户实测崩溃修复（72da3644）：** marketplace 合并视图裸渲染 SkillMenu（useMenuComponents 需 DropdownMenuProvider 容器）→ 有本地技能即崩；按 entity-row 菜单槽模式包裹。种真实数据沙箱复现+回归 PASS。**经验：空环境 E2E 测不出"有数据才触发"的渲染雷，回归沙箱必须种真实数据副本。**
**新发现迁移缺口：** 上游全局技能目录已迁至 `~/.agents/skills`，旧 `~/.workagent/skills`（用户有 20+）新版不读——待决策：是否在迁移助手中一次性搬迁。
**E2E 新增待办：** 无效 key 发消息无限转圈（应快速失败+引导，挂 claude-agent 错误链，并入 401 自愈项）；HTML `<title>` 仍为 Craft Agents；权限弹窗按钮（Allow/Always Allow/Deny）未 i18n（上游问题）；迁移后连接显示名不友好。

## 二-D、差异化补齐冲刺实施记录（2026-06-13 收口，commits 9e29ca91..d7932e37）

| 项 | 要点 | commit |
|------|------|--------|
| **M4.3 hooks→automations 转换器**（迁移助手收口） | `migrate-hooks.ts`：旧 `hooks.json` → automations v2（matcher/cron/timezone/permissionMode/labels 全保留；prompt→PromptAction；command 类 hook 丢弃并计数出 `hooks-migration-report.txt`）；Schema 校验门 + 幂等（改名 `.migrated`）；`loadConfig()` 在 automations.json 缺失时自动触发 | 9e29ca91 |
| **企业 NO_PROXY 三层注入** | `enterprise.noProxyDomains`（.cvte.com/.gz.cvte.cn/localhost/127.0.0.1）合入 NO_PROXY：① 主进程启动 `applyEnterpriseNoProxyToProcessEnv()` ② 子进程 `getProxyEnvVars()`（代理关闭时也注入）③ 用户自配 noProxy 取并集 | 34448dea |
| **M4.2 收口：vars 编辑器 UI** | `skillVars:get/set` RPC（get 仅回 set-状态布尔，值不回流；空串=删除）；SkillInfoPage 内 SkillVarsEditor；8 key × 7 locale | d7932e37 |
| **✅ Pi 路线端到端复测 PASS**（#16②，CDP 沙箱实证） | 打包版 pi-agent-server 子进程正常拉起（vendor/bun + interceptor）→ openai-completions 经网关对话：模型发起 bash 工具调用写文件 → 工具结果回传 → 中文总结回复，agent loop 完整 | （验证项） |
| **✅ 隔离工作目录验证 PASS**（#16③，F2 实证） | `sdkCwd` = per-session 目录；agent 写的 `answer.txt` 落在 `sessions/{id}/` 下；会话目录含 attachments/data/downloads/long_responses/plans/.pi-agent/.pi-sessions 全结构 | （验证项） |
| **✅ 上游核心能力冒烟**（#17） | xlsx 文档工具 PASS（PATH 发现略脆弱→M5 关注）；内置浏览器 PASS（真实截图）；Automations 页面/API PASS；持久化定时触发为 AI 引导式创建流→M5 专项 | （验证项） |
| **🔴 首启崩溃回归修复**（NO_PROXY 冲刺引入，沙箱冒烟拦下） | `applyEnterpriseNoProxyToProcessEnv()` 原在主进程**模块顶层**执行，而它读的 `config-defaults.json` 要到 `ensureConfigDir()` 才落盘——全新安装上 `loadConfigDefaults()` 在 import 期 throw，Electron 弹**阻塞式错误框**（无日志/无 CDP/0% CPU），App 永不启动；**老用户因文件已存在不受影响**。修复：调用移入 `whenReady`（显式 `ensureConfigDir()` 之后）+ `mergedNoProxy` try/catch 软化双保险。全新空 HOME 沙箱复测 PASS（4s 启动、零配置 provisioning 完整、子进程 NO_PROXY 含全部 4 企业域名） | 2498daef |

**🔴 经验（写入记忆）：** 模块顶层副作用**绝不能**依赖"每次启动同步"的 config-defaults.json——首启时序上文件还不存在。任何读 `loadConfigDefaults()` 的代码必须在 `ensureConfigDir()` 之后，或自带 try/catch 软化。**老用户测不出首启雷（文件已存在），必须用全新空 HOME 沙箱验证。**

**⚠️ 新发现（Pi/openai-completions 配置约定）：** 自定义 OpenAI 协议连接的 baseUrl **必须含 `/v1`**（如 `https://token.cvte.com/v1`）——openai SDK 约定 baseURL 后只拼 `/chat/completions`；裸域名会被网关 307 到登录页，且 **Pi SDK 静默吞掉错误返回空回复**（无任何报错，usage 全零）。对比：anthropic-messages 路线代码自动拼 `/v1/messages`，裸域名反而正确。~~待办：连接编辑表单对 openai-completions 增加 `/v1` 提示~~ **已解决（二-F）**：CVTE 预设切 OpenAI 兼容时自动用 token.cvte.com/v1，用户无需手填。

## 二-E、D10/D11 决策实施记录（2026-06-13，用户拍板后）

| 项 | 要点 | 文件 |
|------|------|------|
| **D10 旧技能首启搬迁** | `migrateLegacyGlobalSkills()`：`~/.workagent/skills/*`（带 SKILL.md 的目录）→ `~/.agents/skills/`。复制非移动（原目录留作备份）、目标已存在同名 slug 跳过不覆盖、`CONFIG_DIR/.global-skills-migrated` 标记位幂等、全程 try/catch fail-soft。main `whenReady` 在 ensurePresetThemes 后调用，写 mainLog | `packages/shared/src/skills/migrate-skills-dir.ts`、`apps/electron/src/main/index.ts` |
| **D11 分享改道内网/默认禁用** | `enterprise.viewerUrl` 新增 schema 字段；`resolveViewerUrl()`：企业版配了→内网 viewer、企业版没配→`null`、非企业→craft.do。SessionManager 4 处（share POST/update PUT/revoke DELETE/delete-cleanup DELETE）全改道：上传类 null→返回"未配置"错误（杜绝外流）、删除类 null→跳过网络仅清本地态 | `config-defaults-schema.ts`、`enterprise-defaults.ts`、`SessionManager.ts` |

**设计取向（Just right）**：D10 仿 `migrate-hooks.ts` 同款一次性迁移器，只解决"存量技能消失"这一确切问题；D11 用一个解析器收口 4 个调用点的路由决策，默认值偏向数据安全（未配=禁用，绝不静默外流）。两者都无为未来假设预留的抽象。

## 二-F、连接配置界面 CVTE 化（2026-06-13，用户截图驱动）

**问题**（用户截图）：网关连接的配置/编辑表单落在 `Custom` + `OpenAI Compatible`（token.cvte.com 不匹配任何预设），暴露手填 `pi/CVTE-AUTO,…` 模型列表，文案中英混杂还引用 Ollama/vLLM/DashScope 等无关上游 provider。

| 项 | 要点 | commit |
|------|------|--------|
| **CVTE 一等公民 provider 预设** | `ApiKeyInput` 新增 `cvte-cch` 预设（label「CVTE」，url token.cvte.com），置 ANTHROPIC_PRESETS 首位成为默认。选中即**极简表单**：base URL 输入框 + 手填模型列表全隐藏（端点固定、模型 provisioned + /v1/models 自动获取）。`getPresetForUrl` 把 token.cvte.com 与 …/v1 两种 host 都归到 CVTE 预设，编辑可回显 | 6cd2e0d7 |
| **协议双轨**（用户补充） | CVTE 预设保留协议切换器：**Anthropic 兼容**（默认 → token.cvte.com，Claude Agent SDK 路线 D8，无 customEndpoint）↔ **OpenAI 兼容**（→ token.cvte.com/v1，Pi openai-completions；`/v1` 即 #16 实锤的坑）。服务端 D8 守卫只丢 anthropic-messages 的 customEndpoint，openai-completions 保留 → pi_compat | 6cd2e0d7 |
| **文案清洗（i18n × 7 locale）** | 端点/协议/模型 标签 + 提示全部 i18n 中文（apiSetup.endpoint/protocol/protocolHint/cvteProtocolHint/defaultModel/modelListHint/customModelHint/required/optional + onboarding.credentials.apiKeyDescription[Pi]，11 key × 7 locale，parity+sorted 通过）；删除 Ollama/vLLM/DashScope 引用 | 6cd2e0d7 |
| **对话报错文案** | `invalid_api_key`（errors.ts + claude-sdk-error-mapper.ts）改纯中文三段式：① 取 key URL ② 端点已预置 token.cvte.com 无需填 ③ 模型自动获取 | 6cd2e0d7 |

**✅ CDP 沙箱验证（打包 arm64）：** 网关编辑表单渲染极简中文 CVTE 布局（端点=CVTE 非 Custom、协议 Anthropic 兼容默认、无 base URL/模型列表，截图存档）；切 OpenAI 兼容 + Continue → 连接变 `pi_compat` + `token.cvte.com/v1` + `openai-completions`，Anthropic 保持 `anthropic` + `token.cvte.com`。

**未来衔接：** key 后续可在启动时经 SSO→REST 自动配置（§六）；用户手动编辑时即走此极简表单。

**✅ CDP 沙箱验证（2026-06-13，全新 HOME + 种旧技能）：** D10——种入 `~/.workagent/skills/legacy-test-skill` 首启后复制到 `~/.agents/skills` 并以 `global` 来源被 `getSkills` 加载；无 SKILL.md 的目录正确跳过；原目录保留；二次启动加新旧技能**不再迁移**（marker 拦截）。D11——`shareToViewer` 返回"未配置内网 viewer"错误，**fetch 前 early-return、零 craft.do 外流**。提交 `7c465339`。

**交付物（含 D10/D11 + 首启修复 + 二-F 连接界面 CVTE 化）：** `Craft-Agents-arm64.dmg` SHA-256 前缀 `245b1776abd24f0d`，2026-06-13 12:48 构建。

## 二-G、网关连接自纠错不变量（2026-06-13，用户截图驱动 + plan 模式）

**问题**（用户截图，二-F 之后仍暴露）：模型列表显示 Pi GPT-5/Claude 目录（非 6 个 CVTE 模型）；编辑表单 openai 形态仍回落 Custom + 手填 `pi/CVTE-AUTO`；**手动配置完无法对话**。打包版 CDP 沙箱复现 4 个相互关联的根因，均属网关连接生命周期的健壮性问题。

**根因**：① openai + token.cvte.com **缺 /v1** → 网关 307→Pi 静默吞错空回复（#16 坑，UI 可造出）；② 网关退化成 `providerType:'pi'` 后 `REFRESH_MODELS` 拉回整个 Pi 目录覆盖 models；③ `AiSettingsPage` 对带 customEndpoint 的连接强制 `activePreset='custom'`，绕过 cvte-cch 识别；④ SETUP handler 与每次启动归一化的形态判定逻辑不一致，openai→anthropic 回切落到 `pi`。

**方案：一个共享不变量，两处调用**（plan 模式高质量输出）。网关只允许两种合法形态，由唯一耐久信号 `customEndpoint.api === 'openai-completions'` 决定，其余字段全派生：

| 文件 | 要点 |
|------|------|
| `enterprise-defaults.ts` | `getEnterpriseGatewayIdentity()`/`isEnterpriseGatewayHost()`：host/baseUrl/models 单一事实源 |
| `cvte-gateway-invariant.ts`（新建+9 单测） | `enforceCvteGatewayShape(conn)`：Anthropic 形态(anthropic/token.cvte.com/无 customEndpoint/无 piAuthProvider) ↔ OpenAI 形态(pi_compat/token.cvte.com**/v1**/openai-completions/**piAuthProvider 'openai'**——后者是 Pi 路线触达网关的必需字段，漏了即空回复)。目录守卫**条件式**：仅 models 被污染（非 CVTE 子集）才重置种子，保留 Anthropic 形态 live /v1/models 刷新结果 |
| `storage.ts` | `normalizeCvteGatewayRoute`（每次启动）改委托不变量 → 存量坏连接自愈；新增 `replaceLlmConnection()` 全量替换（updateLlmConnection 的 allowlist 对 undefined 保留旧值，无法在 openai→anthropic 清掉 customEndpoint/piAuthProvider） |
| `llm-connections.ts` SETUP | 网关分支末尾跑不变量做最终覆盖，经 `replaceLlmConnection` 落库（清字段） |
| `AiSettingsPage.tsx` | 编辑按 host 识别网关（含 …/v1）→ cvte-cch 预设，两形态都进极简表单 |

**✅ CDP 沙箱端到端验证（打包 arm64，13/13 + 自愈 + 截图）：** 两形态对话均回"成功"；模型选择器=6 个 CVTE（无 pi/gpt/claude）；裸 host openai 自动补 /v1 后对话通（原静默失败）；openai→anthropic 回切修复为 anthropic（非 pi）；协议无损往返 ×2；手改 config 成 `pi`+GPT 目录坏态 → 重启不变量自愈+落盘+对话通；非网关自定义 openai 连接字节级不受影响；**openai 形态编辑表单显示极简 CVTE 布局（端点=CVTE 非 Custom，截图存档）**。提交 `d183a3ed`。

**✅ 后续补丁（同日，用户截图驱动）：**
- **编辑表单 Continue 报红"requires selecting a provider preset"**（`useOnboarding.ts` + `AiSettingsPage.tsx`）：根因——保存前的连通性预测试在 Pi 流里跑（网关 pi_compat→pi_api_key），`validateSetupTestInput` 拒绝无 preset 的 Pi 自定义端点；且上游测试无法路由网关双协议/选 CVTE 模型。修复：网关恒走 Anthropic 原生流（`getApiKeyMethodForConnection`）+ 跳过对托管网关无意义的预测试（仿 Bedrock 既有做法），保存直接交不变量。两协议沙箱实测：编辑→Continue 无报错、保存正确形态、对话通。
- **间歇 "Unknown Error" 诊断增强**（`claude-sdk-error-mapper.ts`）：沙箱 12 轮压测 0 错（不复现，判定为用户机器侧瞬态/代理抖动）；Claude SDK 路线下 capturedApiError 恒空（拦截器 Pi 专用），原始错误丢失致无用文案。改进：fallback 文案补 `SDK error code: …`，下次复发可凭此精确定位。

**交付物（含全部修复，发版用这版）：** `Craft-Agents-arm64.dmg` SHA-256 前缀 `911d65b4b888f148`（x64 `aa880b9a96f97bda`），2026-06-13 15:26 构建。

---

## 三、待验证项（3 项，先验证上游再裁决）

| 项 | 验证问题 | 旧实现参考 |
|----|---------|-----------|
| 中断会话恢复 | 上游 v0.7.1「跨机器会话恢复」+ v0.7.9「可靠事件投递」是否已覆盖同样痛点 | `claude-agent.ts` +167 行、`session-recovery-{context,format}.ts` |
| AskUserQuestion 工具 | 上游 SDK 0.3.170 + session-scoped-tools 现状是否已有等价交互 | `UserQuestionRequest.tsx`、`session-scoped-tools.ts` |
| Workspace 技能自动触发 | 上游 v0.10.3 的 skill 注入机制是否已有等价行为 | `base-agent.ts` +45 行 |

另：**Windows 捆绑工具（MinGit+Python，~20 提交）降为待验证**——上游 v0.6.0 文档工具集已"无需 Python"、v0.9.0 SDK 改原生二进制，捆绑动机可能已部分消失；在新基线 Windows 裸机实测后再决定是否移植。

---

## 四、弃用 CVTE 实现、采用上游（7 项，约占总提交量一半）

| CVTE 定制 | 上游等价物 | 迁移注意 |
|-----------|-----------|---------|
| 远程控制 relay-server（~17 提交） | v0.7.0 Headless Server + v0.8.0 WebUI/多远程工作区 | `packages/relay-server` 整体弃置 |
| 内置浏览器工具（~25 提交，~4000 行） | v0.6.0 内置浏览器 + v0.10.0 远程桥接 | CVTE browser-cdp/browser-pane 实现弃置 |
| 定时任务调度器（~22 提交） | v0.5.1 Automations v2 + v0.7.7 条件 + v0.7.5 Webhook | 存量 hooks.json 由迁移助手转换（§二.7） |
| i18n 中文化（~23 提交） | v0.8.5 官方 zh-Hans（1050+ 字符串 + 工具链） | 仅保留默认 `zh-CN` 配置；用 CVTE 译文校正上游术语 |
| TipTap 富文本/图片缩放（~5 提交） | 本就 cherry-pick 自上游 v0.6.0/v0.7.0 | 直接弃置 |
| 文件附件增强（~10 提交） | v0.8.1/v0.8.6 大附件分块 + v0.8.12 混合持久化 | 逐项核对后基本可弃 |
| 流式渲染性能优化（~5 提交） | 上游多版本持续优化 | 新基线实测，预期不再需要 |

## 五、弃置

- 8 次版本号 bump、CI 微调
- 根目录调试脚本：`debug-*.ts`、`test-skill-vars*.{ts,sh}`、`diagnose-skill-loading.ts`、`set-skill-vars.ts`、`tmp/`
- 设计文档（无代码，随 docs/ 保留）：AI 会议录音（`2026-03-17-meeting-recording-design.md`）

---

## 六、TODO：待 CVTE 侧补充的外部契约

> **状态：部分提供（2026-06-13），SSO 子项仍未完全解锁**

- [x] **换 key REST API 端点形态**（已提供 2026-06-13）：

  ```
  GET https://token.cvte.com/api/v1/users/{userId}/keys
  Accept: application/json
  X-Api-Key: <调用凭证 —— 真实值不得提交入库，经安全渠道分发>
  ```

- [x] **网关已实测事实**（2026-06-13 协议冒烟）：
  - `/v1/messages` 认证**同时支持** `x-api-key: <key>` 与 `Authorization: Bearer <key>` 两种头
  - anthropic 协议透传完整（含 `thinking` 内容块、`stop_reason`、usage 统计）
  - 直连可用；代理受限环境可用 `--resolve token.cvte.com:443:10.20.10.16` 直指内网 IP（运维备忘）
  - ⚠️ M3 注意：企业内常有系统代理，token.cvte.com 为内网域名——零配置接入应考虑默认把 `*.cvte.com` 加入 NO_PROXY（上游 v0.7.5 的代理支持含 NO_PROXY 规则注入子进程）

- [ ] **X-Api-Key 的性质与边界**（⚠️ 安全关键）：是服务级凭证还是用户级凭证？若为服务级且烘焙进客户端，等于共享密钥可查询任意 userId 的 key——需 CVTE 确认调用方约束（仅内网？IP 白名单？还是该 API 仅供服务端代理调用，客户端不直接持有此凭证）
- [ ] **userId 的获取方式**：SSO 身份 → userId 的映射途径（决定 SSO 子项的实现形态）
- [ ] 响应 JSON 结构示例（keys 字段名、是否多 key、哪个用于网关）
- [ ] SSO 协议类型（OIDC？）、授权端点、客户端注册方式、loopback 回调白名单要求
- [ ] key 的生命周期语义（有效期、轮换策略、吊销行为、401 时的预期处理）
- [x] ~~（可选）网关是否计划实现 `/v1/models` 端点~~ **已实测确认（2026-06-13）：网关已实现 `/v1/models`**，返回 CVTE-AUTO/deepseek-v4-flash/pro/glm-5.1/qwen3.7-max/plus，含 supported_apis/pricing/max_input_tokens 元数据。⚠️ 字段为 OpenAI 风格（无 `display_name`/`created_at`），上游 anthropic driver 的模型拉取解析需小适配（M3）。本次 key 未见 CVTE-SECRET，疑按 key 权限过滤，待确认

### D11 会话分享内网 viewer（代码机制已就位，待部署）

> **完整部署指南：`docs/deployment/intranet-session-viewer.md`**（含 API 契约、可直接运行的参考后端、nginx 配置、加固清单）

- [ ] **部署两个件**：`apps/viewer` 仅是**前端 SPA**（仓库构建即可）；`/s/api` **存储后端不在仓库里**（Craft 用 Cloudflare Pages Functions + R2 实现），需**自建**（参考实现见部署指南 §2）。同源部署在一个内网域名下（建议 `*.gz.cvte.cn`，自动落 NO_PROXY）
- [ ] **回填 `enterprise.viewerUrl`**：拿到内网 viewer origin 后写进 `config-defaults.json` 的 `enterprise.viewerUrl`（一行配置即激活分享，随版本下发）。**在此之前企业版分享处于禁用态**（点分享报"未配置内网 viewer"，杜绝 transcript 外流到 agents.craft.do）
- [ ] **死代码清理（低优先）**：`packages/shared/src/version/{manifest,install}.ts` 指向 `agents.craft.do/electron` 的自更新路径全 repo 零调用（已被我们的 fast-update-server OTA 取代），潜在但 inert 的外流点，可整模块删除

---

## 七、与 CVTE 相关的上游 Breaking Changes 核对单

| 版本 | 变更 | CVTE 影响 |
|------|------|----------|
| v0.5.0 | Codex/Copilot 后端 → Pi SDK | D3 豁免；抽查存量连接类型分布 |
| v0.5.1 | hooks.json → automations.json v2，无自动迁移 | 迁移助手处理（§二.7） |
| v0.8.5 / v0.10.1 | preferences 的 language 字段移除/改 uiLanguage | 迁移助手处理 |
| v0.10.1 | macOS Intel 构建停止 | D4 冻结策略 |
| #171 | 全局技能目录 `~/.workagent/skills` → `~/.agents/skills` | D10 首启自动搬迁（§二-E） |

## 八、长期定制纪律（Phase 3）

1. **同步节奏**：上游每发一个 release 同步一次（单 squash 提交 merge 可控），不再攒版本
2. **定制选择**：只定制「上游永远不会做的」（内网集成、企业策略、品牌）；通用增强优先提 PR 回上游（候选：Skill Variables、`CustomEndpointApi` 增加 `openai-responses`）
3. **登记义务**：每处侵入式修改上游文件的改动，必须在本文档 §二 登记（路径 + 目的 + 成本），这是下次重基线的保险
4. **自动哨兵**：CI 定时检查上游 release → 草稿分支自动 merge + typecheck → 报告冲突面，让落后成本每周可见
5. **版本纪律**：严格执行 D5 方案；GitLab tag 用 `v0.10.301-cvte` 形式避免与上游 tag 混淆
