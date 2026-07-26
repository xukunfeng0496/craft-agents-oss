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

### P0 · 测试基线归零（✅ 已完成，commit `8dfae802`）

在 `.worktrees/rebase-0.11.2` 上修掉上述 4 类缺陷。**不修产品代码，只修测试**。

**为什么必须先做**：重基线过程中会不断跑测试。如果基线本身有 16 个已知红，任何新引入的真实回归都会淹没在噪声里——无法区分"本来就红"和"我刚弄坏的"。这是整个计划的信噪比地基。

**闸门**：`bun test` → **0 个基础设施失败**。实测连续三轮稳定 **4877 pass / 1 fail**，唯一残余是下述真产品 bug。

**⚠️ P0 的边界纪律**：只修**上游独有、CVTE 从未碰过**的测试文件。因为 P1-b 有 133 个文件会被 rc 版整文件覆盖，在 P1 之前修任何 P1-b 类文件都是白工——每修一个就要在 P1 的排除清单里挂一笔账。正确工序是「先把文件搬到最终形态，再在其上做修复」。实际只有 `browser-pane-manager.test.ts` 触碰了这条线，已用排除清单 + `sed` 补 CVTE 改动处理。

**发现的真实产品 bug（✅ 已于 P1 后修复，commit `9391e560`）**：

`apps/electron/src/main/browser-pane-manager.ts` 的 `finalizeDestroyedInstance()` 中，4 个 teardown 清理步骤（`closePopupsForParent` / `applyAgentControlLock` / `updateNativeOverlayState` / `cdp.detach`）全部无 try/catch。任一抛错都会跳过其后的

```ts
this.instances.delete(instance.id)   // 实例泄漏，该 id 无法重建
this.removedCallback?.(instance.id)  // 渲染进程状态永不同步
```

**是疏漏而非设计**——上游作者在 `destroyInstance()` 里已建立 `runCleanup` 保护 helper 并用它包住了完全相同的三个调用，只是漏保护了 `finally` 里 `finalizeDestroyedInstance()` 内的第二次调用。修法：把 `runCleanup` 提为私有方法 `runTeardownStep`，两处复用。

### P1 · 骨架：CVTE-only 文件 + 依赖 + scope 迁移（✅ 已完成，commit `dd6c7a93`）

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

**闸门（已按实测更正）**：搬迁计数吻合 + `bun install` 成功 + 两个 CVTE 独有包测试自洽（`test:packages:cvte` 16+12 全绿）+ `grep -r '@mariozechner'` 源码为空。

> **原定「`typecheck:all` exit 0」是错误的闸门设计，实测已证伪。** P1 只搬零冲突文件，而 CVTE 的**消费方**（组件、handler、测试）与它们引用的 **API 定义方**被分到了不同层——定义恰好都在 P2/P3 的冲突文件里。全绿在原理上不可达，`typecheck:all` 的正确位置是 P3 之后。
>
> 这也顺带兑现了上表最后一行的"假设"：23 个错误里**零个**属于「CVTE-only 文件依赖上游已变更 API」，该风险证伪。

**P1 后遗留的 23 个 typecheck 错误 —— 即 P2/P3 的验收清单**（逐包统计，绕开 `&&` 短路）：

| 缺失符号 | 定义方文件 | 消费方 | 数量 | 归属 |
|---|---|---|---|---|
| `takePendingAssistantError` | `shared/src/agent/event-adapter.ts` | `claude-event-adapter.test.ts` | 3 | P3 #3 |
| `getCvteIdentity` | `shared/src/config/storage.ts` | `server-core/handlers/rpc/marketplace.ts` | 1 | P3 #1 |
| `RPC_CHANNELS.marketplace` | 协议 `channels.ts` | 同上 | 4 | **P2** |
| `RPC_CHANNELS.skillVars` | 协议 `channels.ts` | `server-core/handlers/rpc/skill-vars.ts` | 4 | **P2** |
| `ElectronAPI.{getMarketplaceRegistry,installMarketplaceSkill,startCvtePortalOAuth,isCvtePortalSsoAvailable,getSkillVars,setSkillVars}` | `electron/src/preload/index.ts` | `SkillsListPanel.tsx`/`AiSettingsPage.tsx`/`SkillInfoPage.tsx` | 9 | **P2** |
| `SkillVariable` 类型 | `electron/src/shared/types.ts` | `SkillInfoPage.tsx` | 1 | **P2** |
| 上述缺失导致的隐式 `any` | — | 同上 | 2 | 随之消失 |

> 注意 **9+1 个 electron 错误落在 P2 而非 P4**：IPC 契约（`preload/index.ts` + `shared/types.ts`）与协议 channels 是同一件事的两端，必须同层完成，否则 P2 结束时 electron 仍红。

### P2 · 协议/注册 + IPC 契约 + i18n（0.5 天）

T3 协议加性冲突（`channels.ts`/`routing.ts`/`channel-map.ts`/`dto.ts` + registration 测试）；**IPC 契约两端**（`electron/src/preload/index.ts` 的 6 个方法 + `electron/src/shared/types.ts` 的 `SkillVariable`）；T2 七个 locale 取**并集**（上游 Projects/Kanban 键 + CVTE SSO/市场键）。

**闸门**：`lint:i18n:sorted` + `lint:i18n:parity` + `lint:i18n:coverage` 三绿；协议注册测试绿；**`server-core` 与 `apps/electron` 的 typecheck 归零**（即上表 18 个 P2 错误清零，剩余 4 个 shared 错误留给 P3）。

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

**闸门**：`bun run typecheck:all` → **exit 0**（此处才是它的正确位置，见 P1）；`bun test` → 0 fail（含 `test:shared:cvte` / `test:packages:cvte`）。

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
