# 图片缩放控件功能分析

**分析日期：** 2026-03-08
**上游版本：** v0.7.0（从 v0.3.0 重构）
**分析 Agent ID：** adf38b7d73aba8a5f

## 执行摘要

图片缩放控件功能最初在 **v0.3.0**（2026-01-28）为 Mermaid 图表引入，然后在 **v0.7.0**（2026-03-05）重构并泛化，以支持所有富文本块类型（图片、Mermaid、HTML）。v0.7.0 重构将缩放逻辑提取到可重用组件中。

---

## 1. 提交历史

### 主要提交

1. **436820567432c61326574a822808c96a969c3a0d** - v0.3.0（2026-01-28）
   - MermaidPreviewOverlay 中的初始缩放实现内联
   - 约 400 行缩放/平移逻辑嵌入在组件中

2. **24ab7850cc262f9bb7ca4c77c1c3bc643390b21e** - v0.7.0（2026-03-05）
   - 将缩放逻辑提取到可重用的 hook 和组件中
   - 应用于 ImagePreviewOverlay 和 MermaidPreviewOverlay
   - 减少 MermaidPreviewOverlay 397 行（重构为使用共享 hook）

---

## 2. 文件变更

### 新文件（v0.7.0）
```
packages/ui/src/components/overlay/
├── ZoomControls.tsx                                    (+177 行)
├── useRichBlockInteractions.ts                         (+208 行)
├── rich-block-interaction-spec.ts                      (+42 行)
└── __tests__/
    ├── useRichBlockInteractions.test.ts                (+36 行)
    └── rich-block-parity.test.ts                       (+15 行)
```

### 修改文件
```
packages/ui/src/components/overlay/
├── ImagePreviewOverlay.tsx                             (+146/-66 行)
├── MermaidPreviewOverlay.tsx                           (-397 行，重构)
├── FullscreenOverlayBaseHeader.tsx                     (小更新)
└── index.ts                                            (导出 ZoomControls)
```

### 无关变更（可跳过）
```
packages/ui/src/components/overlay/
├── ActivityCardsOverlay.tsx                            (新功能，无关)
└── HTMLPreviewOverlay.tsx                              (沙箱变更，非缩放)
```

---

## 3. 依赖

**无新增外部依赖** - 该功能是使用现有依赖的纯 React 实现。

---

## 4. 架构

### 核心组件

#### 1. ZoomControls.tsx - UI 组件
- 放大/缩小按钮（Plus/Minus 图标）
- 显示当前缩放百分比的下拉菜单
- 预设菜单（25%, 50%, 75%, 100%, 150%, 200%, 400%, "适应窗口"）
- 重置按钮（RotateCcw 图标）
- 工具提示中显示的键盘快捷键

#### 2. useRichBlockInteractions.ts - 自定义 Hook
- 状态管理：`scale`, `translate`, `isDragging`, `isAnimating`
- 鼠标/触控板事件处理器
- 键盘快捷键（Cmd/Ctrl +/-/0）
- 带光标锚定的滚轮缩放
- 通过点击拖拽平移
- 双击重置
- 辅助函数：`clampScale`, `zoomStepScale`, `cursorAnchoredTranslate`, `computeFitScale`

#### 3. rich-block-interaction-spec.ts - 配置
- 常量：`minScale: 0.25`, `maxScale: 4`, `zoomStepFactor: 1.25`
- 缩放预设：`[25, 50, 75, 100, 150, 200, 400]`
- 滚轮灵敏度（鼠标 vs 触控板捏合）
- 状态/选项/操作的 TypeScript 接口

---

## 5. 功能列表

### 缩放控件
- ✅ 带 +/- 图标的放大/缩小按钮
- ✅ 当前缩放百分比显示（可点击下拉菜单）
- ✅ 预设缩放级别（25%, 50%, 75%, 100%, 150%, 200%, 400%）
- ✅ "适应窗口"选项（90% 容器填充）
- ✅ 重置按钮（返回 100%，居中）
- ✅ 最小/最大缩放限制（0.25x - 4x）

### 鼠标/触控板交互
- ✅ 鼠标滚轮向光标缩放（自适应灵敏度）
- ✅ 触控板捏合缩放（检测滚轮事件上的 `ctrlKey`）
- ✅ 点击拖拽平移
- ✅ 双击重置
- ✅ 缩放期间光标保持稳定（光标锚定变换）

### 键盘快捷键
- ✅ `Cmd/Ctrl +` 或 `=` - 放大（25% 步进）
- ✅ `Cmd/Ctrl -` - 缩小（25% 步进）
- ✅ `Cmd/Ctrl 0` - 重置为 100%
- ✅ `Escape` - 关闭下拉菜单（不关闭覆盖层）

### 视觉反馈
- ✅ 带 `isAnimating` 状态的平滑过渡
- ✅ 光标变化：拖拽期间 `grab` → `grabbing`
- ✅ 最小/最大缩放时按钮禁用状态
- ✅ 下拉菜单中的活动预设指示器（复选标记）
- ✅ 悬停时的不透明度过渡

### 触摸手势
- ❌ 无明确的触摸手势支持（依赖浏览器的触摸到鼠标事件转换）

---

## 6. 与 ImagePreviewOverlay 的集成

### 之前（v0.5.0）
- 简单的适应容器显示
- 无缩放或平移
- 仅单张图片
- 基本加载状态

### 之后（v0.7.0）
- 带 `ItemNavigator` 的多项支持
- 通过 `useRichBlockInteractions` hook 缩放/平移
- 多张图片的内容缓存
- "适应窗口"的尺寸检测
- 标题中集成的 `ZoomControls`

### 关键变更
```typescript
// 添加的 props
items?: PreviewItem[]
initialIndex?: number
title?: string

// 新状态
const { scale, translate, isDragging, isAnimating, zoomByStep, zoomToPreset, zoomToFit, reset, onMouseDown, onDoubleClick } = useRichBlockInteractions({ isOpen, containerRef })

// 带交互处理器的容器
<div ref={containerRef} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
  <img style={{ transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})` }} />
</div>
```

---

## 7. 测试清单

### 单元测试
- ✅ `clampScale` - 边界检查
- ✅ `zoomStepScale` - 放大/缩小步进计算
- ✅ `cursorAnchoredTranslate` - 缩放期间光标稳定性
- ✅ `computeFitScale` - 带填充的适应容器
- ✅ 跨组件的缩放预设一致性
- ✅ 可逆缩放因子（放大 → 缩小返回原始）

### 手动测试
- [ ] 鼠标滚轮向光标缩放
- [ ] 触控板捏合缩放
- [ ] 点击拖拽平移
- [ ] 双击重置
- [ ] 键盘快捷键（Cmd/Ctrl +/-/0）
- [ ] 放大/缩小按钮
- [ ] 预设下拉菜单选择
- [ ] "适应窗口"按钮
- [ ] 重置按钮
- [ ] 带缩放状态重置的多图片导航
- [ ] 最小/最大缩放时禁用缩放控件
- [ ] 点击外部关闭下拉菜单
- [ ] Escape 关闭下拉菜单但不关闭覆盖层

---

## 8. Cherry-Pick 计划

### 策略
**单次提交 cherry-pick** - v0.7.0 包含完整的重构实现。

### 步骤

#### 1. Cherry-pick v0.7.0 缩放变更
```bash
git cherry-pick 24ab785 -- \
  packages/ui/src/components/overlay/ZoomControls.tsx \
  packages/ui/src/components/overlay/useRichBlockInteractions.ts \
  packages/ui/src/components/overlay/rich-block-interaction-spec.ts \
  packages/ui/src/components/overlay/__tests__/useRichBlockInteractions.test.ts \
  packages/ui/src/components/overlay/__tests__/rich-block-parity.test.ts \
  packages/ui/src/components/overlay/ImagePreviewOverlay.tsx \
  packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx \
  packages/ui/src/components/overlay/index.ts
```

#### 2. 更新包导出（如果需要）
- 验证 `packages/ui/src/components/overlay/index.ts` 导出 `ZoomControls`

#### 3. 运行测试
```bash
cd packages/ui
bun test overlay
```

#### 4. 手动验证
- 打开图片预览 → 测试缩放控件
- 打开 Mermaid 图表 → 测试缩放控件
- 验证键盘快捷键工作
- 测试多图片导航

### 潜在冲突

**低风险** - 缩放功能主要是新增的：
- 新文件无冲突
- `ImagePreviewOverlay.tsx` - 如果本地修改了图片预览可能冲突
- `MermaidPreviewOverlay.tsx` - 如果本地修改了 Mermaid 预览可能冲突
- `index.ts` - 简单的导出添加

### 冲突解决

如果 `ImagePreviewOverlay.tsx` 或 `MermaidPreviewOverlay.tsx` 有冲突：

```bash
# 查看冲突
git status

# 手动合并
# 1. 保留 CVTE 的自定义功能
# 2. 添加上游的缩放逻辑
# 3. 集成 useRichBlockInteractions hook
# 4. 在标题中添加 ZoomControls

# 标记为已解决
git add packages/ui/src/components/overlay/ImagePreviewOverlay.tsx
git add packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx

# 继续 cherry-pick
git cherry-pick --continue
```

---

## 9. 验收标准

- ✅ 所有单元测试通过
- ✅ 类型检查无错误
- ✅ 图片预览支持缩放和平移
- ✅ Mermaid 图表支持缩放和平移
- ✅ 键盘快捷键正常工作
- ✅ 鼠标滚轮缩放工作
- ✅ 触控板捏合缩放工作
- ✅ 点击拖拽平移工作
- ✅ 预设缩放级别工作
- ✅ "适应窗口"功能工作
- ✅ 无控制台错误
- ✅ 性能无明显下降

---

## 10. 工程复杂度评估

**工程评估：** 恰到好处

**理由：** 实现恰好解决了陈述的问题（图片和图表的缩放/平移），具有适当的抽象。将缩放逻辑提取到可重用的 hook（`useRichBlockInteractions`）是正确的设计决策，避免了代码重复。没有过度工程（没有为简单的缩放功能设计复杂的插件系统），没有工程不足（适当的测试覆盖和边缘情况处理）。

---

## 11. 预计工作量

**开发时间：** 1-2 小时

**风险等级：** 低 - 主要是新增功能，冲突可能性小

**关键里程碑：**
- 30 分钟：Cherry-pick 文件并解决任何冲突
- 30 分钟：运行测试并验证集成
- 30 分钟：手动测试所有缩放功能
- 30 分钟：提交和文档

---

## 12. 回滚计划

如果发现问题：

```bash
# 方案 1：回退提交
git revert HEAD

# 方案 2：重置到合并前
git reset --hard origin/cvte/main

# 方案 3：保留功能但禁用（如果只是小问题）
# 在 ImagePreviewOverlay.tsx 和 MermaidPreviewOverlay.tsx 中
# 注释掉 ZoomControls 组件和 useRichBlockInteractions hook
```

---

## 13. 总结

图片缩放控件是一个精心设计的功能，为图片和图表预览提供了显著的 UX 改进。重构的架构（可重用的 hook + 独立的 UI 组件）使其易于集成和维护。低风险和短实施时间使其成为上游合并计划中的理想第一步。

