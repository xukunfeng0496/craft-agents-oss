# 上游功能合并分析 - 文档索引

**创建日期：** 2026-03-08
**上游版本：** lukilabs/craft-agents-oss v0.7.1
**当前版本：** cvte/main v0.5.5

## 文档概览

本目录包含从上游仓库合并 4 个关键功能到 CVTE fork 的详细分析。所有分析由并行 Agent 团队完成，提供全面的提交历史、文件变更、依赖关系、集成点和风险评估。

---

## 📚 文档列表

### 1. 主实施计划
**文件：** `upstream-merge-implementation-plan.md`
**内容：** 合并的实施计划，包含所有 4 个功能的详细步骤、命令和验收标准

**包含：**
- 执行摘要和功能概览
- 推荐执行顺序
- 阶段 1：图片缩放控件（完整实施步骤）
- 阶段 2：TipTap 富文本编辑器（部分，待完成）

### 2. TipTap 富文本编辑器分析
**文件：** `tiptap-editor-analysis.md`
**Agent ID：** af4132794a4749da9
**预计时间：** 2-4 小时

**关键发现：**
- 提交：v0.6.0 (9e0b8fb9) + v0.7.0 (24ab785)
- 文件变更：约 40 个文件（20 新增，10 修改，200+ 删除）
- 新增依赖：15 个包（TipTap + KaTeX + 数学插件）
- 关键冲突：Mermaid 包删除，包命名空间
- 风险等级：低-中

### 3. 浏览器自动化工具分析
**文件：** `browser-tools-analysis.md`
**Agent ID：** a019ab0ca6bacfbfe
**预计时间：** 2-3 天

**关键发现：**
- 提交：v0.6.0 (9e0b8fb9) + v0.7.0 (24ab785)
- 文件变更：30+ 个新文件（跨多个包）
- 新增依赖：无（使用 Electron 内置 Chromium 和 CDP）
- 关键集成点：window-manager, sessions, ipc, craft-agent
- 风险等级：中

### 4. 统一网络拦截器分析
**文件：** `network-interceptor-analysis.md`
**Agent ID：** a86cf215f05ee4bb8
**预计时间：** 6-10 小时

**关键发现：**
- 提交：v0.5.0 (8e4104d) + v0.6.0 (9e0b8fb9)
- 文件变更：删除 2 个文件，新增 2 个文件，修改 1 个文件
- 新增依赖：无
- 关键变更：合并两个拦截器为一个统一实现
- 风险等级：中

### 5. 图片缩放控件分析
**文件：** `zoom-controls-analysis.md`
**Agent ID：** adf38b7d73aba8a5f
**预计时间：** 1-2 小时

**关键发现：**
- 提交：v0.7.0 (24ab785)
- 文件变更：5 个新文件，2 个修改文件
- 新增依赖：无（纯 React 实现）
- 关键冲突：最小（主要是新增）
- 风险等级：低

---

## 🎯 推荐执行顺序

| 顺序 | 功能 | 预计时间 | 风险 | 文档 |
|------|------|----------|------|------|
| 1 | 图片缩放控件 | 1-2 小时 | 低 | zoom-controls-analysis.md |
| 2 | TipTap 编辑器 | 2-4 小时 | 低-中 | tiptap-editor-analysis.md |
| 3 | 统一网络拦截器 | 6-10 小时 | 中 | network-interceptor-analysis.md |
| 4 | 浏览器工具 | 2-3 天 | 中 | browser-tools-analysis.md |

**总预计时间：** 3-4 天的活跃工作

---

## 🚀 快速开始

### 开始第一个功能（缩放控件）

```bash
# 1. 创建功能分支
cd /Users/kun/code/litchi/craft-agents-oss
git checkout cvte/main
git checkout -b feat/zoom-controls

# 2. Cherry-pick 文件
git fetch upstream
git cherry-pick 24ab785 -- \
  packages/ui/src/components/overlay/ZoomControls.tsx \
  packages/ui/src/components/overlay/useRichBlockInteractions.ts \
  packages/ui/src/components/overlay/rich-block-interaction-spec.ts \
  packages/ui/src/components/overlay/__tests__/useRichBlockInteractions.test.ts \
  packages/ui/src/components/overlay/__tests__/rich-block-parity.test.ts \
  packages/ui/src/components/overlay/ImagePreviewOverlay.tsx \
  packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx \
  packages/ui/src/components/overlay/index.ts

# 3. 运行测试
cd packages/ui && bun test overlay

# 4. 启动开发服务器
cd ../.. && bun run electron:dev
```

---

**文档维护者：** Claude Opus 4.6
**最后更新：** 2026-03-08
