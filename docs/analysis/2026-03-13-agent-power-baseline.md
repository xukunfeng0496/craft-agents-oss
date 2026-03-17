# Agent Power Baseline Analysis

**分析日期：** 2026-03-13  
**数据文件：** `/tmp/work-agent-before.csv`  
**采样方式：** `scripts/benchmark-electron-process.sh collect --duration 180 --interval 1`  
**样本数：** 180

## 执行摘要

这轮 baseline 的主要功耗来源不是 agent backend，而是 Electron 前端侧，尤其是 `renderer`，其次是 `gpu`。

从分组结果看：

- 前端侧（`main + renderer + gpu + utility`）占总 CPU 的 `97.0%`
- agent backend（`claude_sdk + codex + copilot`）占总 CPU 的 `2.1%`
- `renderer` 单独占总 CPU 的 `60.9%`
- `claude_sdk` 平均 CPU 只有 `1.42`
- 本轮没有观察到 `codex` 或 `copilot` 负载

结论是明确的：当前优化优先级应放在 renderer / GPU 渲染路径，而不是先处理 agent SDK。

## 总体指标

- `avg_cpu=66.46`
- `max_cpu=344.40`
- `avg_mem_pct=1.98`
- `max_mem_pct=2.60`
- `avg_rss_mb=1239.94`
- `max_rss_mb=1648.59`

## 分组结果

| Group | avg_cpu | peak_cpu | avg_rss_mb | peak_rss_mb | avg_count | active_samples |
|------|------:|------:|------:|------:|------:|------:|
| `main` | 1.81 | 13.40 | 284.84 | 286.08 | 1.00 | 54 |
| `renderer` | 40.50 | 141.80 | 494.13 | 638.20 | 1.00 | 180 |
| `gpu` | 22.17 | 33.10 | 106.97 | 109.89 | 1.00 | 180 |
| `utility` | 0.00 | 0.00 | 42.22 | 42.22 | 1.00 | 0 |
| `claude_sdk` | 1.42 | 189.50 | 309.13 | 605.36 | 0.99 | 60 |
| `codex` | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| `copilot` | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| `other` | 0.55 | 40.30 | 2.66 | 312.33 | 0.17 | 9 |

## 归因判断

### CPU

- `renderer` 是主要持续 CPU 来源
- `gpu` 是第二大持续 CPU 来源
- `claude_sdk` 有短时尖峰，但不是主要持续负载
- 180 个样本里，前端侧 CPU 高于 backend 的样本有 `179` 个，backend 高于前端的样本只有 `1` 个

### 内存

- 前端侧占总 RSS 的 `74.9%`
- agent backend 占总 RSS 的 `24.9%`
- `renderer` 平均 RSS `494.13 MB`，峰值 `638.20 MB`
- `claude_sdk` 平均 RSS `309.13 MB`，峰值 `605.36 MB`

内存上 backend 不是可以忽略，但仍然不是主要矛盾。

## 关键峰值窗口

### 1. 最大总 CPU

`2026-03-13T11:32:05`

- `total_cpu=344.40`
- `renderer_cpu=112.50`
- `claude_sdk_cpu=189.50`
- `renderer_rss_mb=541.22`
- `claude_sdk_rss_mb=560.28`
- `process_count=9`

这是一次典型的 backend 尖峰，但它是瞬时事件，不代表整体负载结构。

### 2. 典型持续高负载窗口

以下高负载样本几乎都由前端侧主导：

- `2026-03-13T11:34:25` `frontend_cpu=168.3` `backend_cpu=0.1`
- `2026-03-13T11:32:00` `frontend_cpu=164.8` `backend_cpu=0`
- `2026-03-13T11:35:56` `frontend_cpu=163.3` `backend_cpu=0`
- `2026-03-13T11:32:41` `frontend_cpu=159.9` `backend_cpu=0`
- `2026-03-13T11:34:52` `frontend_cpu=159.0` `backend_cpu=0`

这些点更能代表“持续功耗”的来源。

## 直接结论

1. 当前功耗优化的第一优先级应放在 renderer 渲染路径，而不是 agent SDK。
2. `gpu` 的平均 CPU 明显不低，说明除了 React/Markdown 更新外，界面合成/重绘本身也值得重点查。
3. `claude_sdk` 需要保留关注，但更适合作为第二阶段问题，重点看尖峰，而不是先围绕它做大改动。
4. 后续所有优化验证，都应该继续使用带分组输出的 benchmark CSV，避免回到“只能看总量、不能归因”的状态。
