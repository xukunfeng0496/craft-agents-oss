# E2E 回归谐振器

## 用法
```bash
cd apps/electron && bun run dist:mac   # 先出打包 app（harness 驱动它）；见下方警告
bun run e2e                        # 跑全部无 key 用例
bun run e2e --tags gateway         # 按 tag
bun run e2e --ids R-PROVISION      # 按 id
E2E_CVTE_KEY=sk-xxx bun run e2e --with-key   # 纳入需真实网关 key 的 live 用例
```

> ⚠️ **必须用 `apps/electron` 的 `dist:mac`**（它跑 `scripts/build-dmg.sh`）。仓库根的
> `electron:dist:mac` / `electron:dist:dev:mac` **跳过 SDK 落盘**：`@anthropic-ai/claude-agent-sdk`
> 在 esbuild 里是 `--external`，而 Bun 把它提升到根 `node_modules`，extraResources 够不着 →
> 打出来的 app 一启动就 `Cannot find module '@anthropic-ai/claude-agent-sdk'`，弹原生 modal 卡住主线程，
> 表现为所有用例 `CDP not ready within 30s`（无显示环境时截图也拿不到，只能改 `main.cjs` 挂
> `uncaughtException` 才看得到真错）。

## 事件→永久用例纪律
每修一个 bug：① 先在 `cases/` 加一条失败用例（红）② 修 ③ 跑绿 ④ 用例随修复一起进仓。用例 id 用 `R-<AREA>`，`origin` 写来源事件（日期+commit/issue）。

## 方法论铁律（今天沉淀）
1. 验证 = 运行态观测（驱动 app），不是跑单测代替。
2. 两种 fixture：`clean`（全新空 HOME 测首启时序雷）+ `seeded`（种存量数据测"有数据才触发"的雷），各抓一类。
3. 优先 RPC 驱动（`window.electronAPI`）而非点 UI（Radix 下拉脆）。
4. 竞态类用例**保持 `debug:false`**（CRAFT_DEBUG 会改时序掩盖竞态）。
5. `--user-data-dir` 必加（否则被运行中实例顶掉静默退出）；调用方设 `NO_PROXY`（系统代理劫持 127.0.0.1）。
6. 真机错误读 `~/Library/Logs/@craft-agent/electron/main.log`（不是 `craft-agent/`）。

## Phase 2/3（后续，本计划不含）
- L4 live 诊断收编：`test/diagnostics/gw-diag.sh`（端点对比）、`route-compare.ts`（SDK 多轮可靠性），`E2E_CVTE_KEY` 门控。
- needsKey live 用例：R-CHAT（网关对话）、R-RELAY-PRIV（越权）、R-COLDSTART-STRESS（首次请求竞态 N 轮）。
- Windows：`app-locate` 已支持 win 路径；经 SSH + CDP 隧道在 Windows 机跑同一套用例。
- L3 进 CI：xvfb/headless 或自托管 runner。
