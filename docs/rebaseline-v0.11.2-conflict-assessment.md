# 重基线冲突面预评估：v0.10.3 → v0.11.2

> 为下一轮重基线（跟上游 `craft-agents-oss` v0.10.3 → **v0.11.2**）预判工作量与风险。配合 [`upstream-sync-playbook.md`](./upstream-sync-playbook.md) 使用。
> 生成日期：2026-07-26 · 基线 rc = `cvte/rebase-0.10.3-rc`

## Context

上游自我们基线 v0.10.3（06-09）后连发 5 版到 v0.11.2（07-22），**全部无 breaking change**。大特性 Projects + Kanban 任务板 + Conductor DAG（v0.11.0，beta），加 SDK/Pi 双升级、GPT-5.6/Sonnet-5 模型、若干基础设施修复。本文评估 CVTE 定制与上游改动的**冲突面**，指导重基线的顺序与投入。

**方法（口径说明）**：CVTE fork 曾用 git-filter-repo 抹除泄漏 key 重写历史 → git 祖先与上游 tag 断裂（merge-base=feb61246）。故**不能用 `git rebase`**，只能"以 v0.11.2 为新基线 + 重放 CVTE 定制"。冲突面用**两树内容 diff 的交集**计算（`git diff` 两点=纯树对比，不受断裂祖先影响）：

```
CVTE 定制（diff v0.10.3..rc）     : 391 文件
上游改动（diff v0.10.3..v0.11.2） : 264 文件
⚔️ 交集 = 冲突面                   : 70 文件
```

## 结论摘要（TL;DR）

- **CVTE 护城河零冲突**：321 个 CVTE-only 文件（上游没有）**直接搬**，含全部核心增量包——`portal-key-relay`、`session-share-server`、`config/cvte-gateway-invariant`、`config/enterprise-defaults`、`config-defaults.json`、marketplace 客户端、`download-tools.cjs`、`network-proxy`/`proxy-env`、`website/`。**最大的定制价值不冲突。**
- **模型获取驱动 `drivers/anthropic.ts` 不在冲突面**（上游没动）→ CVTE 网关 `/v1/models` 逻辑直接搬。
- **70 冲突文件**里真正的硬骨头只有 **6 个**；其余 = i18n（机械+门禁保障）/ 依赖（重生成）/ 上游主导（吃上游+补 CVTE 小改）。
- **粗估工作量**：一个有经验的人 **~4–6 个专注工作日**（含门禁全绿 + 签名构建）。风险集中在 `SessionManager.ts` 一个文件。

## 冲突分层

| Tier | 文件 | 上游churn / CVTE churn | 性质 | 风险 |
|---|---|---|---|---|
| **T1 硬骨头** | `server-core/sessions/SessionManager.ts` | 1021 / 107 | 上游 Projects/Kanban/Conductor/后台 agent 全在此；CVTE 的网关 runtime 刷新/mid-stream 需重穿 | 🔴🔴 最高 |
| | `shared/agent/claude-agent.ts` | 291 / 60 | 上游后台 agent keep-alive；CVTE 错误路径（限额 flush） | 🔴 高 |
| | `shared/agent/backend/claude/event-adapter.ts` | 45 / 81 | **刚提交的限额修复(81cfd6dc)在此**；上游只挪了 `task_notification` 类型（对抗验证：**未碰 adaptResult/is_error**）→ 可近乎无痛重放 | 🟡 中 |
| | `shared/config/storage.ts` | 39 / 210 | CVTE 重度定制（normalizeCvteGatewayRoute/迁移/cvteIdentity），上游轻改 | 🟡 中 |
| | `server-core/handlers/rpc/llm-connections.ts` | 13 / 286 | CVTE 极重（SSO/市场/模型获取 handler），上游极轻 → 主要是把 CVTE 叠到上游 13 行改动上 | 🟡 中 |
| | `apps/electron/src/main/auto-update.ts` | 20 / 376 | CVTE 整体重写（自定义 check+版本化 feed）；上游 20 行=**v0.10.4 诊断日志**（想要的红利，需嫁接进 CVTE 版） | 🟡 中 |
| **T2 i18n** | 7 个 locale（en/zh-Hans/es/ja/de/hu/pl）| ~214 / ~76 每个 | 上游加 Projects/Kanban 键；CVTE 加 SSO/市场键 → **并集**；`lint:i18n:{parity,sorted,coverage}` 门禁兜底 | 🟢 机械 |
| **T3 协议/注册** | `protocol/channels.ts`·`routing.ts`·`channel-map.ts`·`dto.ts`·registration 测试 | ~25 / ~18 | 双方各自加通道/DTO，加性冲突 | 🟢 低 |
| **T4 依赖** | `bun.lock`(935/154) + ~15 个 package.json | 多为 up2/cvte2 版本号 | 取上游 SDK 0.3.197 + Pi @earendil-works 0.80.6 + CVTE 自有依赖 → `bun install` 重生成 lock | 🟢 机械 |
| **T5 上游主导** | `FreeFormInput.tsx`(228/2)·`AppearanceSettingsPage`(168/2)·`App.tsx`(100/40)·`prompts/system.ts`(125/26)·`sessions/types.ts`·`session-tools-core/context.ts` 等 ~15 个 | 上游重、CVTE 微（多是 i18n 引用/小逻辑）| 吃上游 + 补 CVTE 小改 | 🟢 低 |
| **CVTE 主导构建** | `electron-builder.yml`(4/41)·`build-dmg.sh`(4/40)·`preload/bootstrap.ts`(2/87) | 上游几乎没动 | CVTE 的签名/OAuth/命名定制直接叠回 | 🟢 低 |

## 6 个硬骨头逐个策略

1. **SessionManager.ts（最高危）**——上游把它按 Projects/Kanban/Tasks/Conductor/后台-agent-registry 大幅重构（新增 `@craft-agent/shared/tasks`、`../tasks`、`labels`、`resolveKeepBackgroundTasksAlive` 等导入）。CVTE 的 107 行是**离散插入**（`refreshConnectionRuntime`、mid-stream 分支、`reinitializeAuth`、模型刷新），不是全文改写 → 策略：以上游新版为底，逐个 hook 点重新插入 CVTE 方法/分支，对照现有测试（`test:*:cvte`）验证。预留最多 1 天。
2. **claude-agent.ts**——上游加后台 agent keep-alive（持久 query、turn 结束不杀子 agent）。CVTE 改动在错误收尾路径（`takePendingAssistantError` flush、recovery）。二者位置相邻但目的不同 → 逐段核对 for-await 收尾块，把 CVTE 的错误上抛重新缝进上游新的收尾逻辑。
3. **event-adapter.ts**——🟢 对抗验证已确认上游**只挪动了 `task_notification` 的类型声明**，未碰 `adaptResult`/`is_error`/`api_retry`/`pendingAssistantError`。我刚提交的限额修复（is_error 裁决 + api_retry status）可近乎无痛重放；唯一注意 `adaptSystem` 里 task_notification 分支与上游新形状对齐。
4. **storage.ts**——CVTE 主导（210 行迁移/网关/身份逻辑）。上游 39 行小改 → 先取上游，再把 `normalizeCvteGatewayRoute`/`migrateCvteGateway*`/`cvteIdentity` 等整块叠回，跑 `storage-startup-migration.test`。
5. **llm-connections.ts**——CVTE 极重（286：`cvte:startOAuth/completeOAuth`、`applyLlmConnectionSetup`、市场、SAVE/SETUP）。上游 13 行几乎不冲突 → 以上游为底，叠回 CVTE 全部 handler，跑守护测试（routing/registration-profiles）。
6. **auto-update.ts**——CVTE 整体重写。上游 20 行=v0.10.4 的**常驻诊断日志**（`~/.craft-agent/logs/auto-update.log`）→ **主动嫁接**：把上游的诊断日志思路并入 CVTE 版的 check→版本化 feed 流程（正好补我们代理 502 难诊断的痛点）。

## 值得主动吃进来的上游红利

| 红利 | 来源 | 对 CVTE 价值 |
|---|---|---|
| auto-update 常驻诊断日志 | v0.10.4 | 直击代理 502 排障（本轮痛点）|
| **Windows 子进程控制台闪窗修复** | v0.10.5（SDK 0.3.197）| 我们刚上 Windows，直接受益 |
| Pi 去掉 20s SSE 硬超时 | v0.11.0（Pi 0.80.3+）| pi_compat 长响应路线受益 |
| config.json 启动自动备份 | v0.10.4 | 呼应我们 OTA 时手动备份 config 的做法 |
| Claude SDK 0.3.170→0.3.197 / Pi scope 迁移 | v0.10.5 / v0.10.4 | 迟早必做的依赖健康升级 |

## 风险与未知（对抗性）

- 🔴 **SessionManager 是单点风险**——上游 1021 行是本次最大变量；建议单独一个 commit、单独验证，别和其他文件混。
- 🟡 **SDK 0.3.197 的 result 消息形状**——我的限额修复依赖 `msg.subtype`/`msg.is_error`。event-adapter 上游 diff 未改这俩字段（低风险），但**重基线时须对 0.3.197 实跑一次 mock-429 验证**（复用 `R-LIMIT-SILENCE` 用例）确认契约不变。
- 🟡 **Pi scope 迁移 `@mariozechner/*` → `@earendil-works/*`**——机械但**面广**（每个 `@mariozechner/pi-ai` 导入都要换 + 版本 0.73.1→0.80.6），漏一个就编译红；`grep -r @mariozechner` 收口。
- 🟢 **Projects/Kanban 仍是 beta**——规格可能再变；若不急，可等它转正再跟，但基础设施红利（诊断日志/闪窗/SDK）越早吃越省心。

## 建议执行顺序（降低返工）

1. **建 worktree**：`git worktree add .worktrees/rebase-0.11.2 -b cvte/rebase-0.11.2-rc v0.11.2`
2. **搬 321 个 CVTE-only 文件**（零冲突，含全部增量包）+ CVTE-only 目录（docs/website/portal-key-relay/…）
3. **依赖**：合并 package.json 依赖 → `bun install` 重生成 `bun.lock`；`grep @mariozechner` 收口 scope 迁移
4. **协议/注册（T3）** → **i18n 并集（T2）** → 跑 `lint:i18n:*` + 守护测试
5. **6 个硬骨头（T1）**，SessionManager 单独一 commit
6. **T5 长尾**：吃上游 + 补 CVTE 小改
7. **门禁全绿**：`typecheck:all` + `test`（含 `test:*:cvte`）+ CDP 沙箱 e2e（含 `R-LIMIT-SILENCE`）+ `check-release-config.ts`
8. **签名构建（fork CI）→ OTA beta → 真机验证 → stable**（按 playbook）

## 验证清单（门禁）

- [ ] `bun run typecheck:all`
- [ ] `bun test`（重点 `test:shared:cvte` / `test:packages:cvte`）
- [ ] `bun run lint:i18n:sorted && lint:i18n:parity && lint:i18n:coverage`
- [ ] CDP 沙箱 e2e 全绿（`R-PROVISION` / `R-NO-FALLBACK` / `R-LIMIT-SILENCE` / 7 例种子）
- [ ] `bun run scripts/check-release-config.ts`（防测试门户/明文 key 漏发）
- [ ] mock-429 对 SDK 0.3.197 复验限额契约
- [ ] `grep -r '@mariozechner'` 应为空
