# 上游功能合并实施计划

**文档版本：** 1.0
**创建日期：** 2026-03-08
**上游版本：** lukilabs/craft-agents-oss v0.7.1
**当前版本：** cvte/main v0.5.5

## 执行摘要

本文档提供了从上游仓库 (lukilabs/craft-agents-oss) 合并 4 个关键功能到 CVTE fork 的详细实施计划。这些功能已通过并行 Agent 团队进行了深入分析，包括提交历史、文件变更、依赖关系、集成点和风险评估。

### 功能概览

| 功能 | 优先级 | 复杂度 | 预计时间 | 风险等级 |
|------|--------|--------|----------|----------|
| 图片缩放控件 | 3 | 低 | 1-2 小时 | 低 |
| TipTap 富文本编辑器 | 1 | 中 | 2-4 小时 | 低-中 |
| 统一网络拦截器 | 4 | 中 | 6-10 小时 | 中 |
| 浏览器自动化工具 | 2 | 高 | 2-3 天 | 中 |

### 推荐执行顺序

1. **图片缩放控件** - 最简单，建立信心和流程
2. **TipTap 编辑器** - 高价值功能，中等复杂度
3. **统一网络拦截器** - 为多提供商支持奠定基础
4. **浏览器工具** - 最复杂，需要前面功能的经验

---

## 阶段 1：图片缩放控件

### 1.1 功能概述

为图片预览和 Mermaid 图表添加缩放和平移功能，提升用户体验。

**核心功能：**
- 缩放控件 UI（放大/缩小按钮、百分比下拉菜单、重置按钮）
- 鼠标滚轮缩放（光标锚定）
- 触控板捏合缩放
- 点击拖拽平移
- 键盘快捷键（Cmd/Ctrl +/-/0）
- 双击重置
- 预设缩放级别（25%, 50%, 75%, 100%, 150%, 200%, 400%）

### 1.2 提交信息

**主要提交：**
- `24ab7850cc262f9bb7ca4c77c1c3bc643390b21e` - v0.7.0 (2026-03-05)

### 1.3 文件变更

**新增文件：**
```
packages/ui/src/components/overlay/
├── ZoomControls.tsx                                    (+177 行)
├── useRichBlockInteractions.ts                         (+208 行)
├── rich-block-interaction-spec.ts                      (+42 行)
└── __tests__/
    ├── useRichBlockInteractions.test.ts                (+36 行)
    └── rich-block-parity.test.ts                       (+15 行)
```

**修改文件：**
```
packages/ui/src/components/overlay/
├── ImagePreviewOverlay.tsx                             (+146/-66 行)
├── MermaidPreviewOverlay.tsx                           (-397 行，重构)
└── index.ts                                            (导出 ZoomControls)
```

### 1.4 依赖变更

**无新增外部依赖** - 纯 React 实现

### 1.5 实施步骤

#### 步骤 1：创建功能分支
```bash
cd /Users/kun/code/litchi/craft-agents-oss
git checkout cvte/main
git pull origin cvte/main
git checkout -b feat/zoom-controls
```

#### 步骤 2：Cherry-pick 文件
```bash
# 从上游 v0.7.0 提取缩放控件相关文件
git fetch upstream
git cherry-pick 24ab7850 -- \
  packages/ui/src/components/overlay/ZoomControls.tsx \
  packages/ui/src/components/overlay/useRichBlockInteractions.ts \
  packages/ui/src/components/overlay/rich-block-interaction-spec.ts \
  packages/ui/src/components/overlay/__tests__/useRichBlockInteractions.test.ts \
  packages/ui/src/components/overlay/__tests__/rich-block-parity.test.ts \
  packages/ui/src/components/overlay/ImagePreviewOverlay.tsx \
  packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx \
  packages/ui/src/components/overlay/index.ts
```

#### 步骤 3：解决冲突（如果有）
```bash
# 检查冲突
git status

# 如果 ImagePreviewOverlay.tsx 或 MermaidPreviewOverlay.tsx 有冲突
# 手动合并，保留 CVTE 的自定义功能，添加上游的缩放逻辑
```

#### 步骤 4：包命名空间检查
```bash
# 检查是否有 @craft-agent 引用（应该没有）
grep -r "@craft-agent" packages/ui/src/components/overlay/ZoomControls.tsx
grep -r "@craft-agent" packages/ui/src/components/overlay/useRichBlockInteractions.ts

# 如果有，替换为 @work-agent
find packages/ui/src/components/overlay/ -type f \( -name "*.tsx" -o -name "*.ts" \) \
  -exec sed -i '' 's/@craft-agent/@work-agent/g' {} +
```

#### 步骤 5：运行测试
```bash
# 单元测试
cd packages/ui
bun test overlay

# 类型检查
cd ../..
bun run typecheck:all
```

#### 步骤 6：手动测试
```bash
# 启动开发服务器
bun run electron:dev

# 测试清单：
# - [ ] 打开图片预览 → 测试缩放控件
# - [ ] 鼠标滚轮缩放
# - [ ] 触控板捏合缩放
# - [ ] 点击拖拽平移
# - [ ] 键盘快捷键（Cmd/Ctrl +/-/0）
# - [ ] 双击重置
# - [ ] 预设缩放级别下拉菜单
# - [ ] "适应窗口"按钮
# - [ ] 打开 Mermaid 图表 → 测试缩放控件
# - [ ] 多图片导航时缩放状态重置
```

#### 步骤 7：提交更改
```bash
git add .
git commit -m "feat: add image zoom controls with pan and keyboard shortcuts

Cherry-picked from upstream v0.7.0 (24ab785).

Features:
- Zoom controls UI (zoom in/out, percentage dropdown, reset)
- Mouse wheel zoom toward cursor
- Trackpad pinch zoom
- Click-drag pan
- Keyboard shortcuts (Cmd/Ctrl +/-/0)
- Double-click reset
- Preset zoom levels (25%, 50%, 75%, 100%, 150%, 200%, 400%)
- Zoom to fit

Changes:
- Added ZoomControls component
- Added useRichBlockInteractions hook
- Updated ImagePreviewOverlay with zoom support
- Updated MermaidPreviewOverlay with zoom support

Testing:
- All overlay tests pass
- Manual testing verified all zoom features work
"
```

#### 步骤 8：推送并创建 PR（可选）
```bash
git push origin feat/zoom-controls

# 如果需要 PR 审查
gh pr create --title "feat: add image zoom controls" \
  --body "Adds zoom and pan functionality to image and Mermaid previews. Cherry-picked from upstream v0.7.0."
```

### 1.6 回滚计划

如果发现问题：
```bash
# 方案 1：回退提交
git revert HEAD

# 方案 2：重置到合并前
git reset --hard origin/cvte/main

# 方案 3：保留功能但禁用（如果只是小问题）
# 在 ImagePreviewOverlay.tsx 中注释掉 ZoomControls 组件
```

### 1.7 验收标准

- ✅ 所有单元测试通过
- ✅ 类型检查无错误
- ✅ 图片预览支持缩放和平移
- ✅ Mermaid 图表支持缩放和平移
- ✅ 键盘快捷键正常工作
- ✅ 无控制台错误
- ✅ 性能无明显下降

---

## 阶段 2：TipTap 富文本编辑器

### 2.1 功能概述

添加 WYSIWYG Markdown 编辑器，支持数学公式、LaTeX 渲染和富文本交互。

**核心功能：**
- TipTap Markdown 编辑器组件
- KaTeX 数学公式渲染（行内 `$...$` 和块级 `$$...$$`）
- LaTeX 代码块支持
- 图片预览块
- 气泡菜单（格式化工具）
- 斜杠命令菜单（插入块）
- 富文本块交互

### 2.2 提交信息

**主要提交：**
- `9e0b8fb9be473939cd90f4258e91138f83df6a68` - v0.6.0 (2026-03-02)
- `24ab7850cc262f9bb7ca4c77c1c3bc643390b21e` - v0.7.0 (2026-03-05)

### 2.3 文件变更

**新增文件（约 20 个）：**
```
packages/ui/src/components/markdown/
├── TiptapMarkdownEditor.tsx
├── TiptapCodeBlockView.tsx
├── TiptapBubbleMenus.tsx
├── TiptapHoverActions.tsx
├── TiptapSlashMenu.ts
├── MarkdownImageBlock.tsx
├── MarkdownLatexBlock.tsx
├── ImageCardStack.tsx
├── math-options.ts
├── link-target.ts
├── rich-block-events.ts
├── RichBlockShell.tsx
├── tiptap-editor.css
├── extensions/
│   ├── TiptapImageBlock.tsx
│   ├── LatexBlock.tsx
│   ├── MermaidBlock.tsx
│   └── RichBlockInteractions.ts
└── __tests__/
    ├── math-options.test.ts
    ├── markdown-link-routing.test.ts
    ├── official-markdown-math-foundation.test.ts
    ├── tiptap-slash-menu.test.ts
    └── tiptap-mermaid-input-helpers.test.ts
```

**修改文件：**
```
packages/ui/src/components/markdown/
├── Markdown.tsx                      (添加 katex、remark-math、rehype-katex 插件)
├── MarkdownMermaidBlock.tsx          (更新为 beautiful-mermaid)
└── index.ts                          (导出新组件)
```

**删除文件：**
```
packages/mermaid/                     (整个包删除，替换为 beautiful-mermaid)
```

### 2.4 依赖变更

**新增依赖（15 个包）：**
```json
{
  "@tiptap/react": "^3.20.0",
  "@tiptap/starter-kit": "^3.20.0",
  "@tiptap/markdown": "^3.20.0",
  "@tiptap/extension-placeholder": "^3.20.0",
  "@tiptap/extension-bubble-menu": "^3.20.0",
  "@tiptap/extension-file-handler": "^3.20.0",
  "@tiptap/extension-image": "^3.20.0",
  "@tiptap/extension-mathematics": "^3.20.0",
  "@tiptap/extension-task-item": "^3.20.0",
  "@tiptap/extension-task-list": "^3.20.0",
  "@tiptap/suggestion": "^3.20.0",
  "tiptap-markdown": "^0.9.0",
  "tiptap-extension-code-block-shiki": "^1.0.0",
  "katex": "^0.16.33",
  "@types/katex": "^0.16.8",
  "remark-math": "^6.0.0",
  "rehype-katex": "^7.0.1",
  "prosemirror-highlight": "^0.15.0",
  "beautiful-mermaid": "^1.1.3",
  "@paper-design/shaders-react": "^0.0.69"
}
```

**删除依赖：**
```json
{
  "@craft-agent/mermaid": "workspace:*"  // 从 packages/ui/package.json 删除
}
```

### 2.5 实施步骤

#### 步骤 1：创建功能分支
```bash
git checkout cvte/main
git pull origin cvte/main
git checkout -b feat/tiptap-editor
```

#### 步骤 2：检查 Mermaid 包冲突
```bash
# 检查 CVTE 是否有自定义 Mermaid 功能
git log --oneline packages/mermaid/
git diff upstream/main...cvte/main -- packages/mermaid/

# 如果有重要的自定义功能，需要决定：
# 选项 1：接受删除，迁移到 beautiful-mermaid
# 选项 2：保留 CVTE 版本，重命名为 @work-agent/mermaid-legacy
# 选项 3：不合并 TipTap 的 Mermaid 部分
```

#### 步骤 3：Cherry-pick v0.6.0（核心 TipTap）
```bash
git fetch upstream
git cherry-pick 9e0b8fb9

# 预期冲突：
# - packages/ui/package.json (命名空间 + mermaid 删除)
# - packages/mermaid/ (删除冲突)
```

#### 步骤 4：解决 package.json 冲突
```bash
# 编辑 packages/ui/package.json
vim packages/ui/package.json

# 变更：
# 1. 保持 "name": "@work-agent/ui" (不改为 @craft-agent/ui)
# 2. 保持 "@work-agent/core" 依赖 (不改为 @craft-agent/core)
# 3. 接受删除 "@craft-agent/mermaid" 或 "@work-agent/mermaid"
# 4. 接受添加 "beautiful-mermaid"
# 5. 接受添加所有 TipTap 依赖

# 标记为已解决
git add packages/ui/package.json
```

#### 步骤 5：解决 Mermaid 包删除冲突
```bash
# 选项 A：接受删除（推荐）
git rm -rf packages/mermaid/

# 选项 B：保留 CVTE 版本（如果有重要自定义功能）
git checkout --ours packages/mermaid/
# 然后手动更新 MarkdownMermaidBlock.tsx 以支持两种渲染器

# 继续 cherry-pick
git cherry-pick --continue
```

#### 步骤 6：Cherry-pick v0.7.0（增强功能）
```bash
git cherry-pick 24ab785

# 预期冲突：
# - package.json (TipTap 扩展添加)
# - Markdown.tsx (如果 CVTE 有本地更改)
```

#### 步骤 7：解决 root package.json 冲突
```bash
vim package.json

# 接受所有 TipTap 依赖添加
# 验证无重复条目

git add package.json
git cherry-pick --continue
```

#### 步骤 8：包命名空间清理
```bash
# 查找任何 @craft-agent 引用
grep -r "@craft-agent" packages/ui/src/components/markdown/

# 替换为 @work-agent（如果有）
find packages/ui/src/components/markdown/ -type f \( -name "*.tsx" -o -name "*.ts" \) \
  -exec sed -i '' 's/@craft-agent/@work-agent/g' {} +
```

#### 步骤 9：安装依赖
```bash
bun install

# 验证 TipTap 包已安装
bun pm ls | grep tiptap
bun pm ls | grep katex
bun pm ls | grep beautiful-mermaid
```

#### 步骤 10：运行测试
```bash
# 单元测试
bun test packages/ui/src/components/markdown/__tests__/

# 类型检查
bun run typecheck:all

# 构建
bun run electron:build
```

