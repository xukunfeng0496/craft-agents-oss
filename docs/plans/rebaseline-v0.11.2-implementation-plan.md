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

### P2 · 协议/注册 + IPC 契约 + i18n（✅ 已完成）

T3 协议加性冲突（`channels.ts`/`routing.ts`/`channel-map.ts`/`dto.ts` + registration 测试）；**IPC 契约两端**（`electron/src/preload/index.ts` 的 6 个方法 + `electron/src/shared/types.ts` 的 `SkillVariable`）；T2 七个 locale 取**并集**（上游 Projects/Kanban 键 + CVTE SSO/市场键）。

**闸门**：`lint:i18n:sorted` + `lint:i18n:parity` + `lint:i18n:coverage` 三绿；协议注册测试绿；**`server-core` 与 `apps/electron` 的 typecheck 归零**（即上表 18 个 P2 错误清零，剩余 4 个 shared 错误留给 P3）。

实际提交：
- `d401e28a` 协议与 IPC 契约叠加
- `b555210d` 语言包并集合并
- `7af809e7` 补回缺失的 i18n coverage 校验脚本 + 修市场两处裸 key

### P3 · 6 个硬骨头（✅ 已完成）

按此顺序，**每个文件单独一个 commit**：

| 顺序 | 文件 | 结果 | commit |
|---|---|---|---|
| 1 | `config/storage.ts` | 上游备份机制与 CVTE 配置项共存 | `8fd8b8fd` |
| 2 | `config/llm-connections.ts` | **实测为 no-op**：上游未改该文件，P1 已带入 CVTE 版 | — |
| 3 | `event-adapter.ts` + `claude-agent.ts` | 缓冲错误上抛 + `latency_update` 事件；行数守恒精确 | `9b28214b` |
| 4 | （同上，合并为一个提交） | — | — |
| 5 | `auto-update.ts` | 上游本文件唯一改动是 `mainLog`→`autoUpdateLog`；顺带修 33 处打包版被静默丢弃的日志 | `5211a18b` |
| 6 | **`SessionManager.ts`** | 0 文本冲突；D11 分享气隙用计数法证明未破；CVTE 定制面实测为 5 项（旧计划写的"4 个 hook 点"未经核验，已更正） | `890bbce0` |

配套修复（非计划内、由闸门逼出来）：
- `b1273ae1` 隔离测试改局部 mock，去掉 13 个会对被测代码说谎的假桩
- `3f075390` 补回被 P1 冲掉的 `~/.craft-agent` → `~/.workagent` 数据目录改名（11 处，其中 5 处是运行时真实路径）
- `b4337d9e` CVTE 网关常量下沉为叶子模块，解开 `useOnboarding` → React 组件的分层倒置
- `76dc0e5d` PrerequisiteManager 隔离测试两处失真（老基线遗留，21 fail → 0）

**闸门（已达成）**：
- `bun run typecheck:all` → exit 0（8 个包）
- `bun run test` → exit 0：主套件 4970 pass / 12 skip / 0 fail（379 文件）+ 5 个 `.isolated.ts` 全绿（36 + 70 + 2 + 3 + 3）。**这是本次重基线里 `.isolated.ts` 循环第一次真正跑完** —— 它挂在 `bun test &&` 之后，主套件此前一直有失败，等于从未执行。
- `lint:i18n:sorted` / `parity` / `coverage` 三绿

### P4 · T5 长尾

**清单不再靠人工估算**，由脚本逐文件三方合并推导（`base=v0.10.3` / `theirs=cvte/rebase-0.10.3-rc` / `ours=当前 worktree`），合并结果 == 当前文件即视为 CVTE 定制已落地：

- CVTE 定制面 = 388 个文件（v0.10.3 → cvte-rc）
- 其中当前 worktree 仍与 cvte-rc 有差异 = 78 个
- 78 个里 21 个已判定"定制已落地"，56 个进入下表，1 个为本计划文档自身

待办按优先级（deltaLines = 三方合并相对当前文件还会新增的行数）：

| 优先级 | 文件 | 冲突 | Δ行 | 说明 |
|---|---|---|---|---|
| P0 | `packages/server-core/src/handlers/rpc/llm-connections.ts` | 0 | +264 | CVTE SSO / 模型市场 / 模型获取 handler，**最大一块未落地定制** |
| P0 | `apps/electron/src/main/index.ts` | 0 | +77 | Windows 工具链 PATH 注入（git/python/node/uv）、`CRAFT_UV`、deep-link |
| P1 | `apps/electron/src/renderer/App.tsx` | 1 | +43 | |
| P1 | `packages/shared/src/agent/base-agent.ts` | 0 | +28 | |
| P1 | `apps/electron/src/renderer/event-processor/types.ts` + `processor.ts` | 0 | +15 / +5 | `latency_update` 的渲染端落点 |
| P1 | `apps/electron/electron-builder.yml` | 0 | +19 | artifactName ×4、`win.extraResources` |
| P1 | `apps/electron/scripts/build-dmg.sh` | 0 | +36 | 校验名与 artifactName 必须同改 |
| P2 | `packages/shared/src/config/preferences.ts` | 0 | +10 | |
| P2 | `apps/electron/src/main/handlers/__tests__/registration.test.ts` | 3 | +15 | |
| P2 | `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` | 2 | +8 | |
| P2 | `scripts/electron-build-main.ts` | 0 | +8 | |
| P2 | `packages/shared/src/prompts/system.ts` (+ 其测试) | 0 | +6 / 0 | |
| P2 | `packages/server-core/src/handlers/rpc/settings.ts` / `index.ts` | 1 / 0 | +5 / +4 | |
| P2 | `packages/shared/src/agent/pi-agent.ts` | 1 | +5 | |
| P2 | `apps/electron/scripts/build-win.ps1` | 0 | +3 | |
| P2 | `apps/electron/src/main/logger.ts` | 0 | +9 | 品牌改名已做，余量待核 |
| P3 | 7 个 locale json | 1 | +3 each | P2 已做并集；这 3 行需单独核对 |
| P3 | 6 个 Δ行=0 的文件 | 0 | 0 | 内容有差异但行数相同：`build-linux.sh`、`handlers/workspace.ts`、`FreeFormInput.tsx`、`SidebarMenu.tsx`、`ChatPage.tsx`、`storage-startup-migration.test.ts`、`models-pi.ts` |
| P5 | 15 个 `package.json` + `bun.lock` | 1 / 17 | +4 / +84 | 版本号方案（CVTE 用 `0.10.301` 式）与锁文件，留到 P5 统一处理 |

**已确认的假阳性**（合并结果与当前文件不同，但当前文件是刻意的更优解，不回退）：
`auto-update.ts`（已合并并规范化日志）、`ApiKeyInput.tsx` / `useOnboarding.ts` / `AiSettingsPage.tsx`（网关常量已下沉到 `renderer/lib/cvte-gateway.ts`）。

**闸门**：`typecheck:all` + `bun run test` + `lint` 全绿；且 `git grep -n 'craftagents://'` → 0 命中（当前仍有 6 处，`deep-link.ts` / `browser-pane-manager.ts` 已是 `workagents://`，cvte-rc 全量为 0）。


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
