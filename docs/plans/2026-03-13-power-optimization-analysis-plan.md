# Power Optimization Analysis Plan

**日期：** 2026-03-13  
**基线分析：** `docs/analysis/2026-03-13-agent-power-baseline.md`

## 目标

基于 2026-03-13 的 baseline，优先定位并降低 renderer / GPU 侧的持续 CPU 消耗，同时保留对 `claude_sdk` 峰值的次级排查。

## 当前判断

基线显示：

- 前端侧占总 CPU 的 `97.0%`
- `renderer` 平均 CPU `40.50`
- `gpu` 平均 CPU `22.17`
- agent backend 总平均 CPU 仅 `2.1%`

所以接下来的计划不是“先优化 agent SDK”，而是：

1. 精确定位 renderer 的热路径。
2. 确认 GPU 持续占用来自什么 UI 行为。
3. 在不破坏交互体验的前提下，压低流式渲染成本。
4. 用相同 benchmark 场景回归验证。

## 最新进展

截至 2026-03-13 当天下午，这一轮排查已经得到两个新结论：

- `ChatDisplay` 的 turn regroup 风暴已经基本压住，`streaming.window` 中 `groupingRuns` 已经从每秒几十次降到接近 0-2 次窗口级波动。
- 仍然存在单会话的 `session.loadSession` 高频读取；`/tmp/main3.log` 中同一个 session 在约 147 秒窗口里出现了 `3176` 次 `session.loadSession`，峰值约 `120 calls/sec`。

这说明当前剩余热点不再是原先的 renderer regroup 本身，而是共享 session 存储层的重复读取。

## 已实施修复

### 2026-03-13 第三轮修复

- 在 `packages/shared/src/sessions/storage.ts` 的 `loadSession()` 增加基于 `mtimeMs + size` 的文件状态缓存。
- 缓存命中时直接返回缓存副本，避免重复 `readFileSync + JSON.parse`。
- perf metadata 新增 `cacheHit` / `exists`，便于在 `main` 日志里区分“调用很多”与“真的重复读盘很多”。
- `deleteSession()` 现在会同步取消 `sessionPersistenceQueue` 的 pending write，并清掉读取缓存，避免删除后被异步回写。

## 下一轮验证重点

下一轮不要只盯 `session.loadSession` 的日志条数，因为调用点本身可能没有减少；更关键的是看：

1. `session.loadSession` 日志里 `cacheHit: true` 是否占绝大多数。
2. `session.loadSession` 的单次耗时是否显著下降。
3. benchmark CSV 中总 CPU、renderer CPU、RSS 是否继续下降。
4. `streaming.window` 是否继续保持低 `groupingRuns`，确认没有引入新的前端回退。

## 当前阶段结论

截至 `after6`：

- `loadSession` 缓存修复已经证明有效，不再是当前主要优化对象。
- `ResizeObserver`、`smoothScroll`、输入区高度补偿这三条布局噪声链路已经基本压住。
- 当前最值得继续投入的方向，是 streaming 内容追加时的 renderer 更新传播范围。

截至当前代码状态，又补了一轮更靠近根因的收缩：

- `StreamingMarkdown` 已经改成 append-aware 增量拆块。
- renderer 侧的 `text_delta` 已经开始合帧提交，不再每个 delta 都立刻更新 atom。
- `updateStreamingContentAtom()` 已经支持“assistant streaming message 后面夹着 tool/status message”时继续原位追加。
- turn grouping 结果开始对未变化的历史 turn 复用旧引用，减少长回答时历史 `TurnCard` 的无效更新。
- `TurnCard` memo 已从“数组引用变化即重渲染”收紧为“内容真实变化才重渲染”。

也就是说，下一阶段的重点不再是“继续减滚动事件”，而是：

1. 缩小 `text_delta -> session.messages` 的复制影响面。
2. 缩小 streaming markdown 的增量解析成本。
3. 尽量让最后一个 streaming turn 更新，而不是让整段历史结构反复参与工作。

## 下一阶段实施顺序

### Step 1: 优化 `StreamingMarkdown`

目标：

- 避免 streaming 时每次追加都全量 `splitIntoBlocks(content)`。
- 让 markdown block 拆分变成 append-aware 的增量过程。

原因：

- 这块边界清晰，改动风险低于 session atom 架构调整。
- 即使后续继续优化 atom 更新，这里也仍然是值得保留的收益。

### Step 2: 评估 `updateStreamingContentAtom()` 的解耦

目标：

- 进一步缩小 `text_delta` 对完整 `messages[]` 的复制范围。

候选方向：

1. 把 streaming assistant 的文本缓存从完整消息对象中临时分离。
2. 保持历史消息引用稳定，只更新最后一个 streaming turn 的最小必要状态。
3. 在 handoff（`text_complete` / `complete`）时再合并回持久结构。

### Step 2 当前落地状态

已经完成：

1. `text_delta` 命中已有 streaming message 时，绕过完整 reducer 路径。
2. 多个 `text_delta` 在 renderer 内按帧合并，减少 atom 写入和 render commit 次数。

下一步只保留一个更大的架构选项待评估：

1. 是否把“正在 streaming 的 assistant 文本”彻底从 `session.messages[]` 中临时拆出去，等 handoff 再合并。

## Phase 1: 建立更细的渲染归因

### 目的

把“renderer 很高”进一步拆成具体路径，而不是停留在组件猜测。

### 代码落点

- `apps/electron/src/main/sessions.ts`
  - `DELTA_BATCH_INTERVAL_MS = 50`
  - `queueDelta()` / `flushDelta()`
- `apps/electron/src/renderer/atoms/sessions.ts`
  - `updateStreamingContentAtom()`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
  - turn grouping
  - auto-scroll / `ResizeObserver`
  - streaming message rendering
- `packages/ui/src/components/markdown/StreamingMarkdown.tsx`
  - block split + memoized block rendering
- `apps/electron/src/renderer/lib/perf.ts`
  - 现有 renderer perf 日志能力

### 任务

1. 给 renderer 的流式链路补更细的 perf mark。
2. 记录每秒收到多少 `text_delta`、合并后多少次 React state 更新。
3. 记录 `ChatDisplay` 在 streaming 时的 commit 频率和单次耗时。
4. 记录 `StreamingMarkdown` 的 block 数量、最后活跃 block 长度、split 耗时。
5. 记录 auto-scroll 的触发频率和 `ResizeObserver` 回调频率。

### 产出

- 一份按时间序列的 renderer perf 日志
- 一份热点排序
- 一份“每次 delta 到底触发了哪些工作”的链路图

## Phase 2: 优先分析流式文本更新成本

### 假设

当前最可疑的是“流式 delta -> session message 更新 -> turn regroup -> markdown rerender -> scroll/resize 连锁反应”。

### 重点检查项

1. `updateStreamingContentAtom()` 是否导致整条 `messages` 数组高频复制。
2. `groupMessagesByTurn(session.messages)` 在 streaming 期间是否仍然成本过高。
3. `StreamingMarkdown` 的 `splitIntoBlocks()` 是否在长回答下变成热函数。
4. 流式消息是否仍然拖动了过多非 streaming turn 的重算或布局。

### 预期动作

1. 如果 turn grouping 成本明显，考虑把 turn 结构缓存到 session 级别，而不是每次 render 基于全部 messages 重新归组。
2. 如果 markdown split 成本明显，考虑把“已完成块”和“当前活跃块”拆到更稳定的数据结构里，避免每次从整段字符串重新扫描。
3. 如果状态复制成本明显，考虑把 streaming assistant 内容从完整 `messages[]` 中进一步解耦，减少高频大对象复制。

## Phase 3: 分析 GPU 和布局/滚动成本

### 假设

`gpu` 平均 CPU `22.17` 说明不只是 JS 计算，界面重绘、滚动跟随、动画、阴影/遮罩也可能在持续烧。

### 重点检查项

1. `ChatDisplay` 中 `ResizeObserver` + debounce scroll 是否在 streaming 时频繁触发重排。
2. `maskImage`、阴影、半透明层、`motion/react` 动画是否放大了合成成本。
3. 流式回答过程中是否存在过度平滑滚动或重复 `scrollIntoView`。
4. `TurnCard`、工具活动卡片、折叠区域在 streaming 时是否引发额外布局抖动。

### 预期动作

1. 对 streaming 场景临时关闭非必要动画，做 A/B 基准。
2. 对自动滚动策略做 A/B：
   - 保留当前 `ResizeObserver`
   - 改为更粗粒度的 raf/throttle
   - streaming 时禁用 smooth scroll
3. 对消息区视觉效果做 A/B：
   - 去掉 mask
   - 去掉部分阴影/滤镜
   - 简化 hover/transition

## Phase 4: 次级分析 agent backend 尖峰

### 目的

不把 agent backend 当主因，但也不忽略 `claude_sdk` 的短时峰值。

### 重点检查项

1. `2026-03-13T11:32:05` 附近 `claude_sdk` 峰值对应的是哪类事件：
   - 大段输出生成
   - 工具调用
   - 会话初始化
   - 配置/索引读取
2. backend 峰值是否会放大 renderer 压力，例如一次性吐出更大块 delta。

### 预期动作

1. 将 backend 峰值时间戳和 renderer perf log 对齐。
2. 判断它是独立问题，还是前端高负载的触发因素。

## Phase 5: 优化执行顺序

### 推荐顺序

1. 先做测量补强，不直接猜。
2. 先改 renderer 流式更新路径。
3. 再改 auto-scroll / layout / animation。
4. 最后再看 `claude_sdk` 尖峰是否值得单独优化。

## 验收标准

### 第一阶段验收

- 可以明确回答 renderer 热点主要来自哪 2-3 个路径。
- 可以量化 `delta -> state update -> render -> scroll` 各阶段开销。

### 优化阶段验收

在保持相同 benchmark 场景下，期望看到：

- `avg_cpu` 明显下降
- `renderer_avg_cpu` 明显下降
- `gpu_avg_cpu` 明显下降
- 高峰样本数量下降
- 交互体验没有明显退化

### 建议目标

- 总 `avg_cpu` 下降 `15%+`
- `renderer_avg_cpu` 从 `40.50` 压到 `30` 左右或更低
- `gpu_avg_cpu` 从 `22.17` 压到 `15` 左右或更低

## 第一批建议直接看的文件

- `apps/electron/src/main/sessions.ts`
- `apps/electron/src/renderer/atoms/sessions.ts`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- `packages/ui/src/components/markdown/StreamingMarkdown.tsx`
- `apps/electron/src/renderer/lib/perf.ts`

## 下一步

`after10` 已经给出一个完整 `180s` 且长输出量更高的好样本，说明这轮 turn 稳定化继续有效。

当前下一步不再是立刻继续改数据结构，而是：

1. 先补准 `streaming.window.renderCommits / renderActualMs` 埋点。
2. 再跑一轮相同口径 benchmark。
3. 只有在新的 commit 渲染指标仍显示明显热点时，才考虑继续深入最后一个 streaming turn 的 markdown / render 传播。
