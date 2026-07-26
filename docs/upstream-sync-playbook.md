# 追随上游迭代 Playbook

如何把 CVTE 企业定制持续、低成本地跟随上游 [`craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss) 的迭代。

## 三个远端

| 远端 | 地址 | 用途 |
|------|------|------|
| `upstream` | github `craft-ai-agents/craft-agents-oss` | 上游主线（只读跟踪）|
| `origin` | gitlab `gz.cvte.cn:xukunfeng/craft-agents-cvte` | CVTE 主仓 + 备份 |
| `fork` | github `xukunfeng0496/work-agents` | 签名+公证 CI（持 6 个 Apple secret）|

> 事实源：定制决策与移植清单看 [`CUSTOMIZATIONS.md`](./CUSTOMIZATIONS.md)（D1–D9）；历程看 [`RELEASE-HISTORY.md`](./RELEASE-HISTORY.md)。

## 何时跟版

- 跟**重要版本**（功能/安全/SDK 升级），不必每个补丁都追。
- `gh release list -R craft-ai-agents/craft-agents-oss` 看上游节奏；评估 delta 与冲突面后再决定。

## 跟版流程

1. **建隔离 worktree**：`git worktree add .worktrees/rebase-<上游版本> -b cvte/rebase-<上游版本>-rc <upstream tag>`。
2. **重放 CVTE 定制**：按 `CUSTOMIZATIONS.md` 清单逐项 cherry-pick / rebase（或重新应用）。
3. **重点冲突面**（历史经验，优先核对）：
   - 网关零配置 / 门户 SSO（`enforceCvteGatewayShape`、relay、`applyLlmConnectionSetup`）
   - 技能市场（header 鉴权，复用门户身份）
   - network-proxy 企业 NO_PROXY 旁路
   - viewer 内网化 + session-share 写鉴权
   - Windows 工具链（download-tools + index.ts PATH 注入）
   - auto-update（自定义 check API + 版本化 feed）
4. **门禁全过**：
   - `bun run typecheck:all`
   - `bun run test`（含 `test:*:cvte` / `test:packages:cvte`）
   - CDP 沙箱 e2e（隔离 HOME 的 7 个种子用例，见 `test/e2e/`）
   - `bun run scripts/check-release-config.ts`（防测试门户/明文 key/localhost relay 漏发；发版前回填生产值后自动放行）
5. **签名构建**：推 `cvte/rebase-<ver>-rc` 到 fork → `gh workflow run build.yml --ref <branch>` → 三 job（build-mac 签名+公证 / build-win / release）。
6. **OTA 分级发布**（见 `CLAUDE.md` Release & OTA 节）：
   - `scripts/sync-fast-update.sh <version> beta` → 灰度 + 契约自检
   - 真机验证（关系统代理，否则 electron-updater 走代理 502）
   - `SKIP_DOWNLOAD=1 scripts/sync-fast-update.sh <version> stable` → 全量（复用本地制品免重下载）
7. **回填**：更新 `CUSTOMIZATIONS.md`（新增/变更的定制）+ `RELEASE-HISTORY.md`（加一条）+ 版本号。
8. **合并**：rc 分支待**大多数用户测试通过**后再 merge 到 `cvte/main`。

## 降低长期跟版成本

- **优先 config-defaults + 企业 hook**，少改上游核心文件 → 缩小冲突面。
- **定制增量模块化、隔离**（教训：技能市场曾"删了又加"——保持独立模块，上游变动时只动一处）。
- **每次跟版同步更新 `CUSTOMIZATIONS.md`**，让下一次重放有据可依。
- 敏感信息（Apple secret / relay admin key / FAST_UPDATE_TOKEN / SSO client_id）**只在 secret/env/内存**，绝不入库；fork 是 PUBLIC，推送前确认无内网配置泄漏。
