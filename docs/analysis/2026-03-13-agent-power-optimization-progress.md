# Agent Power Optimization Progress

**分析日期：** 2026-03-13  
**关联基线：** `docs/analysis/2026-03-13-agent-power-baseline.md`  
**关联计划：** `docs/plans/2026-03-13-power-optimization-analysis-plan.md`

## 执行摘要

2026-03-13 这轮功耗优化已经完成三类高价值修复：

1. 修掉 `ChatDisplay` 的 turn regroup 风暴。
2. 在共享 session 存储层为 `loadSession()` 增加缓存，消除高频重复读盘。
3. 收紧 streaming 期间的滚动/布局链路，最终消除 `ResizeObserver` 和输入区高度补偿带来的布局噪声。

到目前为止，问题归因已经更清楚：

- 持续负载仍然以前端为主，而不是 agent SDK。
- 共享 session 存储的重复读盘曾经是明显噪声源，但现在已经基本压住。
- 当前剩余优化重点，应该转向 streaming 内容更新传播范围，而不是继续盯 `loadSession` 或滚动补偿。

## 最新代码推进

在 `after6` 分析结论基础上，又继续推进了一轮 renderer streaming 优化，但还需要新的 benchmark 验证：

1. `text_delta` 命中已有 streaming assistant message 时，不再走完整 `processAgentEvent -> 全 session 替换` 路径。
2. renderer 侧对同一 session 的多个 `text_delta` 做了 `requestAnimationFrame` 级别合帧，改成“一帧一次 atom 提交”。
3. `updateStreamingContentAtom()` 现在会按 `turnId` 或“最后一个 streaming assistant”定位目标，不再要求目标消息必须是最后一条。

这轮改动的目标不是再压布局噪声，而是继续减少：

- `atomUpdates`
- `renderCommits`
- `text_delta` 导致的 `messages[]` 高频复制次数

## 阶段结果

| 数据 | 样本数 | total_cpu | renderer_cpu | gpu_cpu | total_rss_mb | 备注 |
|------|------:|------:|------:|------:|------:|------|
| baseline `/tmp/work-agent-before.csv` | 180 | 66.46 | 40.50 | 22.17 | 1239.94 | 初始基线 |
| after2 `/tmp/work-agent-after-2.csv` | 180 | 60.30 | 36.03 | 19.93 | 1105.59 | 渲染分组问题开始改善 |
| after4 `/tmp/work-agent-benchmark-71157-20260313-180433.csv` | 180 | 31.71 | 12.08 | 17.60 | 947.18 | `loadSession` 缓存生效后的首个稳定样本 |
| after5 `/tmp/work-agent-benchmark-31723-20260313-185945.csv` | 180 | 36.44 | 13.86 | 20.68 | 1198.16 | 滚动策略局部指标改善，但整机结果回退 |
| after6 `/tmp/work-agent-benchmark-5854-20260313-195251.csv` | 104 | 25.51 | 10.40 | 10.96 | 975.43 | 输入区高度补偿改成合并提交后，方向明显转正 |
| after7 `/tmp/work-agent-benchmark-6570-20260313-222249.csv` | 92 | 38.06 | 15.36 | 17.43 | 1405.47 | 样本不完整，`text_delta` 压力不高，但暴露出新的 icon IPC 噪声 |
| after8 `/tmp/work-agent-benchmark-87193-20260313-223631.csv` | 180 | 18.85 | 7.76 | 8.54 | 1158.98 | 当前最佳完整样本，说明 renderer / GPU 主链路已明显收敛 |
| after9 `/tmp/work-agent-benchmark-3014-20260314-205556.csv` | 95 | 37.35 | 15.50 | 17.66 | 1416.22 | 样本不完整，但 `workspace:readImage` 错误已清零；整体更接近 after7 这类“长输出”场景 |

## 已确认收益

### 1. `loadSession` 风暴已被抑制

对比 `main3.log` 与 `main4.log`：

- `session.loadSession` 次数从 `3176` 降到 `81`
- 调用频率从约 `21.6 次/秒` 降到 `0.22 次/秒`
- 降幅分别约为 `97.4%` 和 `99.0%`

`main4.log` / `main5.log` / `main6.log` 中：

- `cacheHit` 比例稳定在 `75%+`
- 平均耗时约 `0.10ms ~ 0.13ms`
- 说明当前这块已经不是主要问题

### 2. 滚动与布局噪声已经基本清掉

`main4.log` 到 `main6.log` 的流式窗口指标变化：

- `resizeObserverCallbacks` 平均值 `3.25 -> 0.00`
- `smoothScrollCalls` 平均值 `0.58 -> 0.09`
- `animatedHeightAdjustments` 平均值 `3.47 -> 0.00`

这里可以明确判断：

- streaming 时的 `ResizeObserver + smooth scroll` 过于频繁，确实会制造额外布局/合成成本
- 输入区高度动画的逐帧滚动补偿也会放大前端负载
- 这两条链路已经被有效压低

### 4. `after7` 暴露了新的 icon IPC 噪声

`main7.log` 的聚合结果：

- `session.loadSession`：`67` 次，`cacheHit 80.6%`，平均 `0.101ms`
- `streaming.window`：平均 `atomUpdates 2.11`，平均 `groupingRuns 1.85`
- `ResizeObserver` / `smoothScroll` / `animatedHeightAdjustments` 仍然非常低
- 但同时出现了 `84` 次 `workspace:readImage -> Workspace not found`

这说明：

- `text_delta` 轻量更新没有把旧热点重新抬回来
- 当前回退更像是另一个独立噪声源，而不是 streaming markdown / delta 扩散本身
- 新噪声来自 icon 读取失败后的重复 IPC 尝试

### 5. `after8` 证明主优化链路已经显著见效

相对 baseline：

- `total_cpu 66.46 -> 18.85`，下降约 `71.6%`
- `renderer_cpu 40.50 -> 7.76`，下降约 `80.8%`
- `gpu_cpu 22.17 -> 8.54`，下降约 `61.5%`

相对 `after4`：

- `total_cpu 31.71 -> 18.85`
- `renderer_cpu 12.08 -> 7.76`
- `gpu_cpu 17.60 -> 8.54`

这说明：

- `loadSession` 缓存
- regroup 收缩
- 布局噪声治理
- `StreamingMarkdown` 增量拆块
- `text_delta` 合帧与轻量更新

这几轮叠加下来，已经把主功耗链路明显压下来了。

`main8.log` 同时显示：

- `streaming.window` 平均 `renderCommits 2.60`
- 平均 `renderActualMs 0.77`
- 平均 `renderBaseMs 2.25`
- 平均 `groupingRuns 2.00`

这些数值相比前几轮已经非常克制。

### 3. 前端功耗已经显著下降

相对 baseline：

- `after4`：`total_cpu -52.3%`，`renderer_cpu -70.2%`
- `after6`：`total_cpu -61.6%`，`renderer_cpu -74.3%`，`gpu_cpu -50.6%`

虽然 `after6` 只有 `104` 个样本，不算最终定版数据，但方向已经非常明确。

## 关键判断

### 1. 当前不是 agent SDK 主导

即使在 `after6` 里，持续功耗结构仍然是前端优先：

- `renderer + gpu + main` 仍是主要持续来源
- `claude_sdk` 主要表现为短时尖峰，而不是长期占用

所以后续优化顺序仍然应当是：

1. renderer 流式更新传播范围
2. markdown / turn 渲染成本
3. 最后才是 agent SDK 尖峰

### 2. 当前剩余高 ROI 热点是“streaming 内容更新传播范围”

目前已知：

- regroup 风暴已压住
- `loadSession` 风暴已压住
- 滚动与布局噪声已压住

剩下最可疑的点就是：

- `text_delta` 到 renderer 后，仍然会更新完整 `session.messages`
- `StreamingMarkdown` 在 streaming 时仍会随着内容追加做拆块工作
- 历史 turn 虽然已尽量 memo，但最后一个 streaming turn 仍有进一步缩窄更新范围的空间
- icon / asset 读取失败后的重复 IPC 重试，也开始进入高 ROI 队列

## 建议下一步

下一阶段建议直接推进两件事：

1. 优化 `StreamingMarkdown`
   - 把“每次追加都全量 `splitIntoBlocks(content)`”改成 append-aware 的增量拆块。
2. 评估 `updateStreamingContentAtom()` 的进一步解耦
   - 尽量缩小 `text_delta` 对完整 `messages[]` 的复制范围。

其中第 1 项已经完成，第 2 项已推进到“renderer 侧合帧 + 已存在 streaming message 的轻量更新”这一阶段。

此外，基于 `after7` 的新发现，又补了一轮小而直接的修复：

1. `icon-cache` 对空 `workspaceId` 直接短路，不再发起 `readWorkspaceImage` IPC。
2. icon 文件 miss 现在会进入 renderer 侧 miss cache，避免每次 render / mount 都重复探测。

继续往下追时，又确认了一个更准确的根因：

1. `FreeFormInput` 为了 skill mention qualification 计算了 `workspaceSlug`。
2. 这个 `workspaceSlug` 被误传给了 `RichTextInput` 的 icon preload。
3. `readWorkspaceImage` IPC 需要的是 workspace UUID，而不是 slug，于是 main 进程持续报 `Workspace not found`。

这个错位已经修正，下一轮日志里理论上不应再看到这批 `workspace:readImage` 报错。

`after9` 已验证这点：

- `workspace:readImage -> Workspace not found`：`0` 次
- 说明 `workspaceSlug` / `workspaceId` 错位问题已经修干净

但 `after9` 也补充了一个重要判断：

- `after8` 的 `total_deltaChars` 只有 `62`
- `after9` 的 `total_deltaChars` 约 `553`
- `after7` 的 `total_deltaChars` 约 `584`

也就是说，`after8` 与 `after9` 的输出负载并不在同一量级，不能只看总 CPU 直接对比。
从可比性上，`after9` 更接近 `after7`；而这两者几乎持平，说明本轮新增修复主要是清掉 icon IPC 噪声，并没有把“长输出场景”的 renderer 成本进一步压低到 `after8` 的水平。

## 风险与注意事项

- `after6` 只有 `104` 个样本，仍建议补一个完整 `180s` 的确认样本。
- benchmark 外部测试手法即便一致，内部运行态仍可能受 session 恢复、SDK 进程数量、窗口焦点状态影响。
- 后续结论应优先看“多轮趋势 + 日志归因”，不要只看单次总 CPU。

## 下一轮验证建议

建议用同样口径再跑一轮完整 `180s` benchmark，并同时保留 main 日志：

- CSV：例如 `/tmp/work-agent-after-7.csv`
- 日志：例如 `/tmp/main7.log`

重点看这轮新增改动是否继续压低：

- `renderer_cpu`
- `gpu_cpu`
- `streaming.window.atomUpdates`
- `streaming.window.renderCommits`
- `streaming.window.processedEvents / atomUpdates` 的比值
- `workspace:readImage` 是否还会出现高频 `Workspace not found`

如果下一轮确认 `workspace:readImage` 已消失，而总量仍接近 `after8`，这轮 renderer 功耗优化可以认为已经完成第一阶段收口。

截至 `after9`，第一阶段可以认为已经基本完成：

1. 结构性噪声项已经基本清干净。
2. 长输出场景下的剩余成本，开始更直接地与输出体量相关。
3. 下一阶段如果继续做高 ROI 优化，应优先盯“长回答 / 大块 delta”时最后一个 turn 的渲染与 markdown 成本，而不是继续追 `loadSession`、icon IPC 或滚动补偿。
