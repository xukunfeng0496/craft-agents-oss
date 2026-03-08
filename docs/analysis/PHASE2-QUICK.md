# 阶段 2：TipTap 编辑器 - 快速指令

请帮我执行上游功能合并的阶段 2：将 TipTap 富文本编辑器功能从上游合并到 CVTE fork。

## 基本信息
- 项目路径：`/Users/kun/code/litchi/craft-agents-oss`
- 当前分支：`cvte/main`
- 目标功能：TipTap 富文本编辑器（数学公式、LaTeX 渲染）
- 上游提交：v0.6.0 (9e0b8fb9) + v0.7.0 (24ab785)

## 详细文档
完整的执行指令在：`docs/analysis/PHASE2-INSTRUCTIONS.md`

## 关键决策
1. **Mermaid 包处理：** 上游删除了 `packages/mermaid/`，替换为 `beautiful-mermaid`
   - 先检查：`git log --oneline packages/mermaid/`
   - 如果没有 CVTE 自定义功能，接受删除

2. **包命名空间：** 将所有 `@craft-agent` 替换为 `@work-agent`

## 执行步骤
按照 `docs/analysis/PHASE2-INSTRUCTIONS.md` 中的详细步骤执行，主要包括：
1. 创建功能分支 `feat/tiptap-editor`
2. Cherry-pick v0.6.0 和 v0.7.0 的文件
3. 添加 15 个新依赖（TipTap + KaTeX + 数学插件）
4. 更新 Markdown.tsx（手动合并）
5. 处理 Mermaid 包
6. 包命名空间清理
7. 运行测试
8. 提交更改

## 验收标准
- 所有测试通过
- 数学公式渲染：`$E = mc^2$`
- LaTeX 块工作：`$$\int_0^\infty e^{-x^2} dx$$`
- Mermaid 图表仍然渲染
- 无控制台错误

预计时间：2-4 小时
