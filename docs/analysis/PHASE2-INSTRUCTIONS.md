# 阶段 2：TipTap 富文本编辑器合并指令

**复制以下内容给新的 Claude Code 会话**

---

## 📋 任务说明

请帮我执行上游功能合并的阶段 2：将 TipTap 富文本编辑器功能从上游 v0.6.0 + v0.7.0 合并到 CVTE fork。

## 📚 背景信息

- **项目路径：** `/Users/kun/code/litchi/craft-agents-oss`
- **当前分支：** `cvte/main`
- **上游版本：** lukilabs/craft-agents-oss v0.7.1
- **目标功能：** TipTap 富文本编辑器（支持数学公式、LaTeX 渲染）

## 📖 详细文档

所有分析文档已准备好，位于 `docs/analysis/` 目录：

1. **主要参考文档：**
   - `docs/analysis/tiptap-editor-analysis.md` - TipTap 功能分析（基础版本）
   - `docs/analysis/upstream-merge-implementation-plan.md` - 主实施计划
   - `docs/analysis/SUMMARY.md` - 执行摘要

2. **关键信息：**
   - 上游提交：v0.6.0 (9e0b8fb9) + v0.7.0 (24ab785)
   - 预计时间：2-4 小时
   - 复杂度：中
   - 风险等级：低-中

## ⚠️ 关键决策点

### 1. Mermaid 包处理（重要！）

上游删除了整个 `packages/mermaid/` 目录，替换为 `beautiful-mermaid` npm 包。

**需要决策：**
```bash
# 先检查 CVTE 是否有自定义 Mermaid 功能
git log --oneline packages/mermaid/
git diff upstream/main...cvte/main -- packages/mermaid/
```

**选项：**
- **选项 A（推荐）：** 接受删除，迁移到 `beautiful-mermaid`
- **选项 B：** 保留 CVTE 版本，重命名为 `@work-agent/mermaid-legacy`
- **选项 C：** 不合并 TipTap 的 Mermaid 部分

**如果没有重要的自定义功能，选择选项 A。**

### 2. 包命名空间

- 上游使用 `@craft-agent/*`
- CVTE fork 使用 `@work-agent/*`
- **操作：** 在所有 cherry-pick 的文件中将 `@craft-agent` 替换为 `@work-agent`

## 🎯 执行步骤

### 步骤 1：创建功能分支

```bash
cd /Users/kun/code/litchi/craft-agents-oss
git checkout cvte/main
git pull origin cvte/main
git checkout -b feat/tiptap-editor
```

### 步骤 2：检查 Mermaid 包冲突

```bash
# 检查 CVTE 是否有自定义 Mermaid 功能
git log --oneline packages/mermaid/ | head -10
git diff upstream/main...cvte/main -- packages/mermaid/

# 如果输出为空或只有上游的提交，可以安全删除
# 如果有 CVTE 特定的提交，需要评估是否保留
```

### 步骤 3：Cherry-pick v0.6.0（核心 TipTap）

```bash
git fetch upstream

# 提取 TipTap 核心文件
git checkout 9e0b8fb9 -- \
  packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx \
  packages/ui/src/components/markdown/TiptapCodeBlockView.tsx \
  packages/ui/src/components/markdown/MarkdownImageBlock.tsx \
  packages/ui/src/components/markdown/MarkdownLatexBlock.tsx \
  packages/ui/src/components/markdown/ImageCardStack.tsx \
  packages/ui/src/components/markdown/math-options.ts \
  packages/ui/src/components/markdown/link-target.ts \
  packages/ui/src/components/markdown/tiptap-editor.css \
  packages/ui/src/components/markdown/__tests__/math-options.test.ts \
  packages/ui/src/components/markdown/__tests__/markdown-link-routing.test.ts
```

### 步骤 4：Cherry-pick v0.7.0（增强功能）

```bash
# 提取 v0.7.0 的增强功能
git checkout 24ab785 -- \
  packages/ui/src/components/markdown/TiptapBubbleMenus.tsx \
  packages/ui/src/components/markdown/TiptapHoverActions.tsx \
  packages/ui/src/components/markdown/TiptapSlashMenu.ts \
  packages/ui/src/components/markdown/RichBlockShell.tsx \
  packages/ui/src/components/markdown/rich-block-events.ts \
  packages/ui/src/components/markdown/extensions/TiptapImageBlock.tsx \
  packages/ui/src/components/markdown/extensions/LatexBlock.tsx \
  packages/ui/src/components/markdown/extensions/MermaidBlock.tsx \
  packages/ui/src/components/markdown/extensions/RichBlockInteractions.ts \
  packages/ui/src/components/markdown/__tests__/official-markdown-math-foundation.test.ts \
  packages/ui/src/components/markdown/__tests__/tiptap-slash-menu.test.ts \
  packages/ui/src/components/markdown/__tests__/tiptap-mermaid-input-helpers.test.ts
```

### 步骤 5：更新 Markdown.tsx（手动合并）

```bash
# 查看上游的 Markdown.tsx 变更
git show 9e0b8fb9:packages/ui/src/components/markdown/Markdown.tsx > /tmp/upstream-markdown.tsx

# 手动合并以下变更到 packages/ui/src/components/markdown/Markdown.tsx：
# 1. 添加 remark-math 插件
# 2. 添加 rehype-katex 插件
# 3. 添加 MarkdownLatexBlock 组件
# 4. 添加 MarkdownImageBlock 组件
# 5. 导入 katex/dist/katex.min.css
```

### 步骤 6：更新 package.json（添加依赖）

在 **根目录的 package.json** 中添加以下依赖：

```json
{
  "@types/katex": "^0.16.8",
  "@tiptap/extension-placeholder": "^3.20.0",
  "@tiptap/react": "^3.20.0",
  "@tiptap/starter-kit": "^3.20.0",
  "@tiptap/extension-bubble-menu": "^3.20.0",
  "@tiptap/extension-file-handler": "^3.20.0",
  "@tiptap/extension-image": "^3.20.0",
  "@tiptap/extension-mathematics": "^3.20.0",
  "@tiptap/extension-task-item": "^3.20.0",
  "@tiptap/extension-task-list": "^3.20.0",
  "@tiptap/markdown": "^3.20.0",
  "@tiptap/suggestion": "^3.20.0",
  "beautiful-mermaid": "^1.1.3",
  "katex": "^0.16.33",
  "prosemirror-highlight": "^0.15.0",
  "rehype-katex": "^7.0.1",
  "remark-math": "^6.0.0",
  "tiptap-extension-code-block-shiki": "^1.0.0",
  "tiptap-markdown": "^0.9.0"
}
```

### 步骤 7：更新 packages/ui/package.json

```json
// 删除（如果存在）
"@craft-agent/mermaid": "workspace:*"

// 或替换为
"@work-agent/mermaid": "workspace:*"

// 添加 peerDependencies
"peerDependencies": {
  "katex": ">=0.16.0",
  "rehype-katex": ">=7.0.0",
  "remark-math": ">=6.0.0"
}

// 添加 dependencies
"dependencies": {
  "@paper-design/shaders-react": "^0.0.69",
  "beautiful-mermaid": "*"
}
```

### 步骤 8：更新导出（index.ts）

在 `packages/ui/src/components/markdown/index.ts` 中添加：

```typescript
export { TiptapMarkdownEditor, type TiptapMarkdownEditorProps, type MarkdownEngine }
export { MarkdownImageBlock, type MarkdownImageBlockProps }
export { ImageCardStack, type ImageCardStackProps, type ImageCardStackItem }
```

### 步骤 9：包命名空间清理

```bash
# 检查是否有 @craft-agent 引用
grep -r "@craft-agent" packages/ui/src/components/markdown/

# 如果有，替换为 @work-agent
find packages/ui/src/components/markdown/ -type f \( -name "*.tsx" -o -name "*.ts" \) \
  -exec sed -i '' 's/@craft-agent/@work-agent/g' {} +
```

### 步骤 10：处理 Mermaid 包（根据步骤 2 的决策）

**如果选择选项 A（删除）：**
```bash
git rm -rf packages/mermaid/
```

**如果选择选项 B（保留）：**
```bash
# 保持 packages/mermaid/ 不变
# 确保 MarkdownMermaidBlock.tsx 可以同时支持两种渲染器
```

### 步骤 11：安装依赖

```bash
bun install

# 验证 TipTap 包已安装
bun pm ls | grep tiptap
bun pm ls | grep katex
bun pm ls | grep beautiful-mermaid
```

### 步骤 12：运行测试

```bash
# 单元测试
bun test packages/ui/src/components/markdown/__tests__/

# 类型检查
bun run typecheck:all

# 构建（可选，耗时较长）
# bun run electron:build
```

### 步骤 13：提交更改

```bash
git add .
git commit -m "feat: add TipTap rich text editor with math rendering

Cherry-picked from upstream v0.6.0 (9e0b8fb9) and v0.7.0 (24ab785).

Features:
- TipTap WYSIWYG markdown editor
- KaTeX math rendering (inline and display)
- LaTeX code blocks
- Image preview blocks
- Bubble menus and slash commands
- Rich block interactions

Changes:
- Added TipTap dependencies (@tiptap/react, extensions)
- Added math dependencies (katex, remark-math, rehype-katex)
- Replaced @craft-agent/mermaid with beautiful-mermaid
- Updated namespace from @craft-agent to @work-agent

Breaking Changes:
- Removed packages/mermaid/ (replaced by beautiful-mermaid)

Testing:
- All markdown tests pass
- Math rendering verified

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### 步骤 14：手动测试（可选）

```bash
bun run electron:dev

# 在应用中测试：
# 1. 创建新会话
# 2. 测试数学公式：$E = mc^2$
# 3. 测试 LaTeX 块：$$\int_0^\infty e^{-x^2} dx$$
# 4. 测试 Mermaid 图表
# 5. 测试图片上传
```

## ✅ 验收标准

- [ ] 所有单元测试通过
- [ ] 类型检查无错误
- [ ] 数学公式渲染正常
- [ ] LaTeX 块工作
- [ ] Mermaid 图表仍然渲染
- [ ] 图片上传工作
- [ ] 无控制台错误
- [ ] 包命名空间正确（@work-agent）

## 🐛 常见问题

### 问题 1：Mermaid 包冲突

**症状：** `packages/mermaid/` 删除时有冲突

**解决：**
```bash
# 检查是否有本地更改
git status packages/mermaid/

# 如果有重要更改，选择保留
git checkout --ours packages/mermaid/

# 如果没有，接受删除
git rm -rf packages/mermaid/
```

### 问题 2：包命名空间错误

**症状：** 类型检查报错 `Cannot find module '@craft-agent/...'`

**解决：**
```bash
# 全局替换
find packages/ui/src/components/markdown/ -type f \
  -exec sed -i '' 's/@craft-agent/@work-agent/g' {} +
```

### 问题 3：依赖安装失败

**症状：** `bun install` 报错

**解决：**
```bash
# 清理缓存
rm -rf node_modules
rm bun.lockb

# 重新安装
bun install
```

## 📊 预期结果

完成后，您应该有：

- ✅ 约 40 个文件变更
- ✅ 15 个新增依赖
- ✅ TipTap 编辑器组件
- ✅ 数学公式渲染支持
- ✅ 所有测试通过
- ✅ 一个新的提交在 `feat/tiptap-editor` 分支

## 🔄 完成后

完成后，请告诉我结果，我会帮您：
1. 审查更改
2. 合并到主分支
3. 继续下一个功能（统一网络拦截器或浏览器工具）

---

**注意：** 如果遇到任何问题或不确定的地方，请随时询问。特别是 Mermaid 包的处理需要谨慎决策。

**预计时间：** 2-4 小时

**祝顺利！** 🚀

