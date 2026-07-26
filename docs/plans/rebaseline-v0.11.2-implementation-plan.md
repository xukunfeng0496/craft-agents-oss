# 重基线实施计划：v0.10.3 → v0.11.2

> 配套阅读：[`../rebaseline-v0.11.2-conflict-assessment.md`](../rebaseline-v0.11.2-conflict-assessment.md)（冲突面）· [`../upstream-sync-playbook.md`](../upstream-sync-playbook.md)（流程）· [`../CUSTOMIZATIONS.md`](../CUSTOMIZATIONS.md)（定制清单）
> 制定日期：2026-07-27 · 起点 rc = `cvte/rebase-0.10.3-rc` @ `8ba1dbf7` · 目标基线 = 上游 `v0.11.2` @ `a60ebc1a`

## 目标

把 CVTE fork 从上游 v0.10.3 基线抬到 **v0.11.2**，产出可签名分发的 `cvte/rebase-0.11.2-rc`，CVTE 全部定制功能（网关/SSO/市场/OTA/Windows 工具链/会话分享）行为不回退。

## Architecture

因 fork 历史被 git-filter-repo 重写、与上游 tag 祖先断裂（merge-base = `feb61246`），**不能 `git rebase`**。采用「**以 v0.11.2 为新基线 + 分层重放 CVTE 定制**」：新建 worktree 直接 checkout `v0.11.2`，把 391 个 CVTE 改动文件按冲突性质分 5 层依次叠加，每层设一道可自动判定的验收闸门。

**Engineering Assessment:** Just right
**Reason:** 分层顺序不是任意的——每层的闸门恰好能捕获该层引入的失败模式（P1 typecheck 抓 API 漂移、P2 i18n lint 抓键缺失、P3 单元测试抓逻辑回归），不存在为假想场景准备的抽象；层数取决于冲突面的客观分布（评估文档 T1–T5），不是人为切分。

## 已验证前提（本轮独立复核，非沿用旧结论）

| 事实 | 证据 | 把握 |
|---|---|---|
| v0.11.2 就是上游最新版 | GitHub API `releases/latest` = v0.11.2 (07-22) · `upstream/main` tip = `a60ebc1a` · 本地 tag 列表一致，三方吻合 | **事实** |
| 冲突面 70 文件 / 上游改 264 文件 | 独立复算，与评估文档精确吻合；6 个硬骨头 churn 逐个吻合 | **事实** |
| v0.11.2 `typecheck:all` 可全绿 | 旧 lockfile 锁 tsc 5.0.2 → 8 个假阳性；升 5.9.3 后 **exit 0** | **事实** |
| v0.11.2 无真实产品回归 | 16 个 fail 逐个定性，**全部**为测试基础设施缺陷（详见 P0） | **事实** |
| 两个 CVTE 独有包可直接搬 | `portal-key-relay`/`session-share-server` 对上游仅耦合 `RPC_CHANNELS`、`readFileAttachment` 两个符号，v0.11.2 均健在 | **事实** |
| 其余 CVTE-only 文件的上游 API 耦合 | 未逐一验证——由 P1 的 typecheck 闸门兜底暴露 | **假设** |

### v0.11.2 测试基线定性（16 fail 全部归零可达）

| 失败 | 数量 | 根因 | 性质 |
|---|---|---|---|
| `BrowserPaneManager` | 8 | 测试 mock 缺 `popupWindow.webContents` | 上游测试缺陷 |
| `startWebuiHttpServer` | 6 | `oauth-callback-url.test.ts:9-10` 在**模块顶层**把 `globalThis.fetch` 换成恒返回 404 的 mock 且**永不还原**；`bun test` 同进程加载所有文件 → 污染后续文件 | 跨文件污染 |
| `refreshConnectionRuntime` | 1 | 测试读**真实磁盘 config**；假 slug 走三级回退到全局默认，装过 app 的机器绿、干净机器红 | 环境耦合 |
| `headless server smoke` | 1 | 未隔离 `CRAFT_CONFIG_DIR`，撞用户运行中 app 的单实例锁 | 环境耦合 |

另加一项预防性加固：`bun test` **不读 `.gitignore`**，会扫进 `apps/electron/release/**` 的打包源码副本（`electron-builder.yml` 设了 `asar: false`，副本是裸文件）——在 rc worktree 上造成 13 个陈旧副本假失败。用 `bunfig.toml` 的 `[test] pathIgnorePatterns` + `package.json` 里 `find` 的 `-not -path` 一并封堵。

> **两条定性均经实验钉死，且都推翻了我最初的假设**：
> - `refreshConnectionRuntime`：rc + 空 config → 红；rc + 真实 config → 绿；v0.11.2 + 种子 config → 绿。**与版本无关**，100% 由磁盘状态决定 → 推翻"上游真回归"。
> - `startWebuiHttpServer`：单跑 6 pass；`CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL=1` 全量跑仍 6 fail；`oauth-callback-url` + `http-server` 二元组即可复现 → 推翻"preload 网络拦截器劫持"。症状本身就是反证——真被拦截器挡会 **throw**，不会返回一个规整的 404 Response。

## 阶段与闸门

每个阶段结束必须过闸门才进下一阶段。闸门红了就地修，不累积。

### P0 · 测试基线归零（0.5 天，进行中）

在 `.worktrees/rebase-0.11.2` 上修掉上述 4 类缺陷。**不修产品代码，只修测试**。

**为什么必须先做**：重基线过程中会不断跑测试。如果基线本身有 16 个已知红，任何新引入的真实回归都会淹没在噪声里——无法区分"本来就红"和"我刚弄坏的"。这是整个计划的信噪比地基。

**闸门**：`bun test` → **0 fail**。

### P1 · 骨架：CVTE-only 文件 + 依赖 + scope 迁移（1 天）

**精确分流**（本轮独立复算，`git diff --name-status v0.10.3 rc` × `git diff --name-only v0.10.3 v0.11.2`）：

| 类别 | 数量 | 处理 |
|---|---|---|
| P1-a 纯新增（上游无同名） | 121 | 直接拷贝 |
| P1-b CVTE 改过 · 上游未动 | 134 | 用 rc 版**整文件覆盖**（等价于叠加 CVTE 修改，因两边 base 相同） |
| P1-c CVTE 删除 | 62 | 照删（**全部**是 `apps/electron/resources/release-notes/`，与上游改动零交集） |
| A ∩ 上游改动（双方新增同名） | **0** | 无此类，少一种决策 |
| ⚔️ 留给 P3 的真冲突 | 70 | 见 P3 |

> 255 个可机械处理 + 62 删除 = 317，与评估文档的「321 直接搬」互相印证（差值为本轮新增的 2 个 commit）。

**⚠️ 与 P0 的执行顺序约束**：P0 修改的 4 个上游测试文件中，`apps/electron/src/main/__tests__/browser-pane-manager.test.ts` 落在 P1-b —— 盲目覆盖会**盖掉 P0 的修复**。处置：P1 覆盖时排除该文件，改为单独补上 CVTE 对它的全部改动（经查仅 2 行：`craftagents://` → `workagents://` 协议改名，`sed` 即可）。`package.json` / `bun.lock` 本就在 P3 手工合并，合并时保留 P0 改动即可；`bunfig.toml`、`oauth-callback-url.test.ts`、`smoke.test.ts`、`refresh-connection-runtime.test.ts` 四者 CVTE 从未改过，P0 版本原样保留，无冲突。

**步骤**：

1. 按上表三类批量搬迁
2. 合并 package.json 依赖 → `bun install` 重生成 `bun.lock`（保留上游 SDK 0.3.197 + Pi `@earendil-works` 0.80.6）
3. `@mariozechner/*` → `@earendil-works/*` scope 迁移收口

**闸门**：`bun run typecheck:all` → exit 0 且 `grep -r '@mariozechner'` 为空。

> 这道闸门是**上表最后一行"假设"的兑现点**——CVTE-only 文件若依赖了上游已变更的 API，此处必红。红了不是意外，是设计目的。

### P2 · 协议/注册 + i18n（0.5 天）

T3 协议加性冲突（`channels.ts`/`routing.ts`/`channel-map.ts`/`dto.ts` + registration 测试）；T2 七个 locale 取**并集**（上游 Projects/Kanban 键 + CVTE SSO/市场键）。

**闸门**：`lint:i18n:sorted` + `lint:i18n:parity` + `lint:i18n:coverage` 三绿；协议注册测试绿。

### P3 · 6 个硬骨头（2 天，最高风险）

按此顺序，**每个文件单独一个 commit**：

| 顺序 | 文件 | 策略 | 单文件闸门 |
|---|---|---|---|
| 1 | `storage.ts` | 取上游 39 行，叠回 `normalizeCvteGatewayRoute`/`migrateCvteGateway*`/`cvteIdentity` | `storage-startup-migration.test` |
| 2 | `llm-connections.ts` | 以上游 13 行为底，叠回 CVTE 全部 handler（SSO/市场/模型获取） | routing / registration-profiles 测试 |
| 3 | `event-adapter.ts` | 重放限额修复（`81cfd6dc`）；上游只挪了 `task_notification` 类型声明 | 限额相关单测 |
| 4 | `claude-agent.ts` | 把 CVTE 错误上抛缝进上游新的 keep-alive 收尾块 | agent 单测 |
| 5 | `auto-update.ts` | CVTE 版为底，**嫁接**上游 v0.10.4 常驻诊断日志 | 手工核对 + `check-release-config.ts` |
| 6 | **`SessionManager.ts`** | 上游新版为底，逐个 hook 点重插 CVTE 的 `refreshConnectionRuntime`/mid-stream 分支/`reinitializeAuth`/模型刷新 | `test:*:cvte` 全绿 |

> 先易后难：前 5 个 CVTE 主导、上游轻改，做完能建立对新基线代码结构的手感，再啃 SessionManager 的 1021 行。

**闸门**：`bun test` → 0 fail（含 `test:shared:cvte` / `test:packages:cvte`）。

### P4 · T5 长尾（0.5 天）

约 15 个上游主导文件（`FreeFormInput.tsx`、`AppearanceSettingsPage`、`App.tsx`、`prompts/system.ts` 等）：吃上游 + 补 CVTE 小改。构建定制（`electron-builder.yml`、`build-dmg.sh`、`preload/bootstrap.ts`）直接叠回。

**闸门**：`typecheck:all` + `bun test` + `lint` 全绿。

### P5 · 门禁与分发（1–1.5 天）

1. `bun run scripts/check-release-config.ts`（防测试门户/明文 key 漏发）
2. CDP 沙箱 e2e：`R-PROVISION` / `R-NO-FALLBACK` / `R-LIMIT-SILENCE` / 7 例种子
3. **mock-429 对 SDK 0.3.197 复验限额契约**（见风险表）
4. 推 `fork` → `gh workflow run build.yml` → 签名+公证
5. OTA **beta** 通道 → 真机验证 → 观察 → `stable`

**闸门**：验证清单全勾 + 真机 beta 无回归报告。

## 风险与对策（对抗性）

| 风险 | 等级 | 对策 |
|---|---|---|
| `SessionManager.ts` 上游 1021 行重构，CVTE 需重穿 4 个 hook 点 | 🔴 最高 | 单独 commit、单独验证、放在最后做；失败可单独回退不牵连其他层 |
| CVTE-only 文件依赖了上游已变更的 API（未验证） | 🟡 | P1 typecheck 闸门是专门的暴露机制；耦合面已知最小的两个包已证伪 |
| SDK 0.3.197 的 result 消息形状变化，冲掉限额修复 | 🟡 | 限额修复依赖 `msg.subtype`/`msg.is_error`；event-adapter 上游 diff 未碰这两字段（低风险），但 P5 必须 mock-429 实跑复验 |
| Projects/Kanban 仍是 beta，规格可能再变 | 🟢 | 不主动集成 beta 特性到 CVTE 界面，仅承接代码 |
| 重基线失败需回滚 | 🟢 | rc 分支与线上 `0.10.318` 均不动；OTA 可停留 stable 不推 beta |
| **11 个 `cvte/main` docs commit 从未推送，仅存本机磁盘** | 🔴 | **非技术风险但后果最重**——含重基线知识库/SSO 契约/D10–D11 决策唯一事实源。需用户授权后尽快推送备份 |

## 工作量

**4.5–6 个专注工作日**（P0 0.5 + P1 1 + P2 0.5 + P3 2 + P4 0.5 + P5 1–1.5）。与评估文档的 4–6 天吻合，多出的 0.5 天是 P0——评估文档未预见测试基线本身不干净。

## 分支与提交策略

- 实施分支：`cvte/rebase-0.11.2-rc`（worktree `.worktrees/rebase-0.11.2`，已建，基于 `v0.11.2`）
- `cvte/main` 与 `cvte/rebase-0.10.3-rc` **全程不动**
- 每个阶段至少一个 commit；P3 每个硬骨头一个 commit，commit message 写清「上游改了什么 / CVTE 叠回了什么」
- 合并到 `cvte/main` 只在广泛真机验证之后（沿用现有分支政策）
