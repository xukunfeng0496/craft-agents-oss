# 恢复 Windows 内置工具子系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans。本计划是**移植 + 适配**型(从历史 GitHub 镜像移植 + 适配到 0.10.3 native-SDK 架构),含一个必须在真机做的 spike。Steps 用 `- [ ]`。

**Goal:** 把 rebaseline 丢失的 Windows 内置工具子系统(MinGit + embedded Python + pip + Bash 支持)恢复到 `cvte/rebase-0.10.3-rc`,让 Windows 版 agent 的 shell/git/python 工具链可用。

**Architecture:** 从历史 GitHub 镜像 `xukunfeng0496/work-agents`(cvte/main,2026-03 构建的成熟子系统)移植 6 块组件,**关键适配**=把历史 `agent-env.ts` 的 PATH 注入改接到 0.10.3 的 `buildClaudeSubprocessEnv`(options.ts:185)。Windows build 走 GitHub Actions windows-latest(能访问 github/python.org/aliyun;内网 GitLab 够不到)。

**Tech Stack:** electron-builder(NSIS extraResources)、MinGit 2.44.0、Python 3.12.8 embedded + pip、GitHub Actions windows-latest、Node CJS 下载脚本。

**Engineering Assessment:** Just right
**Reason:** 不是新造——历史已有 10+ 提交、CI 守护的成熟实现,本质是移植 + 适配到新 SDK 架构;唯一新增的判断是"native SDK 的 Bash 如何吃内置 MinGit",用一个真机 spike 收口,不预先抽象。

---

## 历史参照(事实源)

GitHub `xukunfeng0496/work-agents` @ `cvte/main`:
- `build-windows.yml`:checkout→bun install→`tools:download`→`verify-bundled-tools.js`→`build-win.ps1`→upload .exe
- `test-windows-bundled-tools.yml`:download+verify+`bun test`+`typecheck:all`
- 脚本族:`download-tools.cjs`(MinGit 2.44.0 + Python 3.12.8 embed)、`setup-embedded-pip.cjs`、`configure-pip-mirror.cjs`(**阿里云** `mirrors.aliyun.com/pypi`)、`preinstall-packages.cjs`、`prepare-windows-tools.cjs`、`verify-bundled-tools.js`
- 运行时:`bundled-tools.ts`(`getBundledGitPath/PythonPath`,打包态 `resources/tools/{mingit,python}`,env `WORK_AGENT_BUNDLED_TOOLS_DIR` 覆盖)+ `tool-detection.ts`(Windows 内置优先)+ agent-env 注入 PATH
- 关键提交:`074387a3`(feat/windows-bundled-tools 合入,3-01)、pip 波(3-06)、`b7fc9ec7`(3-17,**Bash 走内置 MinGit**)、`01ef2435`(3-22 打包优化)

## ⚠️ 核心风险 / 不确定性
0.10.3 的 Claude Agent SDK 是 **native `claude` 二进制**(非旧 JS 路径)。历史让 Bash 工具用 MinGit bash 是 v0.4.x 的旧实现;**native 二进制在 Windows 如何解析 Bash/git——是否只要把 MinGit 的 `cmd` + `usr/bin`(bash.exe)放进子进程 PATH 即可——必须在真机验证(P0 spike)**。这条不通,整个 Windows agent 工具链就不通。

---

## Phase 0 — Spike:验证 native SDK 在 Windows 的工具解析(真机,阻塞性)

**前置**:Windows 测试机(经 SSH+CDP 联动,见 e2e harness)+ 一把可轮换网关 key。

- [ ] **P0.1** 手动在 Windows 机放一份 MinGit(`mingit/cmd/git.exe`+`mingit/usr/bin/bash.exe`)+ Python embedded,把这两目录 prepend 到一个最小 spike:启动当前 0.10.3 Windows 包(无内置工具),但用 `WORK_AGENT_BUNDLED_TOOLS_DIR` 或临时改 `buildClaudeSubprocessEnv` 把路径注入 SDK 子进程 PATH。
- [ ] **P0.2** 经 CDP 驱动 agent 跑一条 **Bash 工具**任务(如 `ls` / `git status`)+ 一条 **python** 任务。观测:native 二进制能否经 PATH 找到 bash/git/python。
- [ ] **P0.3** 结论:① 仅 PATH 注入即可 → 走 Phase 2 的 PATH 方案;② 需额外 env(如 `SHELL`/`CLAUDE_BASH_PATH` 之类 SDK 变量)或 SDK 不吃自定义 bash → 记录确切机制,据此调整 Phase 2。**spike 不通则升级讨论(可能需联系 SDK 上游 / 换方案)。**
- [ ] **P0.4** 把结论写进本计划的 Phase 2 注解 + memory。

## Phase 1 — 下载器 + 脚本族(平台无关,可本机做)

- [ ] **P1.1** 从历史 repo 取 `apps/electron/scripts/download-tools.cjs`(MinGit 2.44.0 + Python 3.12.8 embed,幂等),原样移植到 worktree;核对 URL 仍可达。
- [ ] **P1.2** 移植 `verify-bundled-tools.js`、`prepare-windows-tools.cjs`。
- [ ] **P1.3** `apps/electron/package.json` 加脚本:`tools:download`、`tools:clean`、`prebuild:win`(=tools:download)。
- [ ] **P1.4** 本机跑 `bun run tools:download`(下载到 `apps/electron/resources/tools/{mingit,python}`)+ `verify-bundled-tools.js` 通过(下载产物不入库,gitignore 核对)。
- [ ] **P1.5** commit。

## Phase 2 — 运行时定位 + PATH 注入(核心适配,依赖 P0 结论)

- [ ] **P2.1** 移植 `packages/shared/src/tools/bundled-tools.ts`(`getBundledGitPath/PythonPath/getBundledToolExtraPaths`),适配 0.10.3 的 `resources/tools` 布局 + `getBundledAssetsDir` 风格路径解析。
- [ ] **P2.2** 移植 `tool-detection.ts` 逻辑(Windows 内置优先于系统);0.10.3 无此文件,按需新建或并入现有检测。
- [ ] **P2.3** **关键**:在 `options.ts:buildClaudeSubprocessEnv` 里,Windows 下把 `getBundledToolExtraPaths()`(mingit/cmd + mingit/usr/bin + python)**prepend 到 `env.PATH`**;按 P0 结论补任何额外 env。非 Windows 不变。
- [ ] **P2.4** 单测:`bundled-tools.ts` 路径解析(mock 平台/resources)+ `buildClaudeSubprocessEnv` 在 win32 注入了路径、在 darwin 不注入。
- [ ] **P2.5** commit。

## Phase 3 — pip 子系统

- [ ] **P3.1** 移植 `setup-embedded-pip.cjs`(给 embedded Python 装 pip)。
- [ ] **P3.2** 移植 `configure-pip-mirror.cjs`——**决策点**:阿里云公网镜像(历史)vs CVTE 内网 PyPI。默认阿里云;若企业要求内网,改 index-url(需用户确认)。
- [ ] **P3.3** 移植 `preinstall-packages.cjs`(预装常用包)+ 接进 `tools:download` 链。
- [ ] **P3.4** 本机/真机验证 pip 可用(`python -m pip --version` + 一次 `pip install`)。
- [ ] **P3.5** commit。

## Phase 4 — 打包 + CI

- [ ] **P4.1** `apps/electron/electron-builder.yml` 的 `win.extraResources` 加 `{from: resources/tools, to: app/resources/tools}`(或与 historical 一致的布局);mac/linux 不带。
- [ ] **P4.2** 移植/适配 `.github/workflows/build-windows.yml`(加 tools:download+verify;对接 CVTE 的 release/fast-update 同步,参照现有 build.yml 的 GitHub-mirror→内网同步说明)。
- [ ] **P4.3** 移植 `test-windows-bundled-tools.yml`(适配 0.10.3 的 `bun test`/`typecheck:all`)。
- [ ] **P4.4** 触发 GitHub Actions(windows-latest)出带内置工具的 .exe;artifact 下载。
- [ ] **P4.5** commit。

## Phase 5 — Windows 真机端到端验证(并入 e2e harness)

- [ ] **P5.1** 装 P4 的 .exe 到 Windows 机(经 SSH)。
- [ ] **P5.2** 在 e2e harness 加 needsKey live 用例 `R-WIN-TOOLS`:经 CDP 驱动 agent 跑 Bash(`ls`)+ git(`git --version`)+ python(`python --version`),断言用的是**内置**工具(路径含 resources/tools)且成功。
- [ ] **P5.3** 经 SSH+CDP 隧道在 Windows 上跑该用例 → 绿。
- [ ] **P5.4** 更新 memory + CLAUDE.md(把"Windows 内置工具"段落与实际对齐——当前 CLAUDE.md 描述存在但 worktree 已无,恢复后重新一致)。

---

## 移植映射表(历史 → 0.10.3)

| 历史文件(github cvte/main) | 0.10.3 落点 | 适配 |
|---|---|---|
| `scripts/download-tools.cjs` | 同路径 | 原样 + 核 URL |
| `scripts/{verify-bundled-tools.js,prepare-windows-tools,setup-embedded-pip,configure-pip-mirror,preinstall-packages}.cjs` | 同路径 | pip 镜像决策 |
| `packages/shared/src/tools/bundled-tools.ts` | 同路径 | 适配 resources 布局 |
| `src/main/tool-detection.ts` | 同/并入 | 适配 |
| (历史 agent-env.ts 的 PATH 注入) | **`options.ts:buildClaudeSubprocessEnv`** | 改接,依 P0 结论 |
| `electron-builder.yml` win extraResources | 同 | 加 tools/ |
| `.github/workflows/build-windows.yml` + `test-windows-bundled-tools.yml` | 同 | 适配 0.10.3 + CVTE 发布流 |

## 验证总览
- P1/P3:本机 `tools:download`+verify+pip ok。
- P2:单测(路径解析 + win/darwin 注入差异)。
- P4:GitHub Actions 出 .exe。
- **P5:真机 e2e `R-WIN-TOOLS` 绿(内置 Bash/git/python 实际可用)——最终门禁。**

## 风险登记
1. **P0 spike 是阻塞性前提**——native SDK 不吃内置 bash 则全盘需重新设计。
2. 真机依赖(P0/P5)——需 Windows 测试机就绪(SSH 联动)。
3. pip 镜像:阿里云(公网)vs CVTE 内网,按企业网络定。
4. SDK 版本漂移:历史是 v0.4.x,0.10.3 的工具/Bash 实现可能变,P0 先探。
