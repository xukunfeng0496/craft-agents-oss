# Model Capability Probe And Patch Guide

## 目的

这份文档给测试、运维、平台同学使用，用来完成下面这条链路：

1. 对某个网关模型或路由模型做 capability probe
2. 生成 capability report
3. 从 report 生成 connection capability patch
4. 预览 patch 会如何修改指定 connection
5. 显式 apply 到指定 `config.json`

当前这套流程主要解决：

- `CVTE-AUTO` 这类网关模型不能只靠模型名猜能力
- 不同 routed model 在 `tool_use`、`structured_output`、`pdf_document`、`multi_turn_tool_loop` 上差异较大
- 需要把 probe 结果稳定落到 connection `capabilities`，让运行时策略真正生效

## 当前能力映射范围

目前 probe report 会映射到这些 capability 字段：

- `supportsDocumentBlocks`
- `supportsToolUse`
- `supportsStructuredOutput`
- `supportsMultiTurnToolLoop`

注意：

- `supportsVision` 目前不会从 probe report 自动推导
- `supportsVision` 如需启用，仍建议平台侧明确给出，或手工补到 connection `capabilities`
- 默认策略对 routed/unknown model 是保守的，这符合当前设计

## 配置文件位置

默认配置目录：

```bash
~/.workagent/config.json
```

如果设置了 `WORK_CONFIG_DIR`，则使用：

```bash
$WORK_CONFIG_DIR/config.json
```

## 前置条件

### 1. 配置探测用环境变量

Anthropic-compatible 网关一般至少需要这些之一：

```bash
export ANTHROPIC_BASE_URL="https://your-gateway.example.com"
export ANTHROPIC_API_KEY="..."
```

或者：

```bash
export ANTHROPIC_BASE_URL="https://your-gateway.example.com"
export ANTHROPIC_AUTH_TOKEN="..."
```

### 2. 建议先备份配置

在 apply 之前，先做一次备份：

```bash
cp ~/.workagent/config.json ~/.workagent/config.json.bak
```

## Step 1: 运行 capability probe

示例：

```bash
bun run scripts/model-capability-probe.ts \
  --models CVTE-AUTO,glm-5,glm-4.7 \
  --output ./tmp/model-capability-report.json
```

输出是一个 report JSON，结构大致如下：

```json
{
  "generatedAt": "...",
  "baseUrl": "...",
  "authMode": "api-key",
  "reports": [
    {
      "model": "glm-4.7",
      "profile": "tool-agent-compatible",
      "probes": [
        { "name": "tool_use", "status": "pass" },
        { "name": "structured_output", "status": "pass" },
        { "name": "multi_turn_tool_loop", "status": "fail" },
        { "name": "pdf_document", "status": "pass" }
      ]
    }
  ]
}
```

## Step 2: 只生成 patch

如果只想看 patch，不绑定任何 connection：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/model-capability-report.json
```

如果只关心特定模型：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/model-capability-report.json \
  --models CVTE-AUTO
```

输出示例：

```json
{
  "capabilities": {
    "byModel": {
      "CVTE-AUTO": {
        "supportsDocumentBlocks": false,
        "supportsToolUse": true,
        "supportsStructuredOutput": false,
        "supportsMultiTurnToolLoop": false
      }
    }
  }
}
```

## Step 3: 预览指定 connection 的配置变更

如果想看 patch 合并到某个 connection 之后的结果，但不写回：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/model-capability-report.json \
  --models CVTE-AUTO \
  --config ~/.workagent/config.json \
  --connection-slug cvte-gateway
```

这个命令会：

- 打印 capability 变化摘要
- 输出合并后的完整 `config.json`
- 不会修改原文件

摘要示例：

```text
CVTE-AUTO: supportsDocumentBlocks, supportsToolUse, supportsStructuredOutput, supportsMultiTurnToolLoop
```

## Step 4: 显式 apply 到指定 config

只有加上 `--apply` 才会原地写回：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/model-capability-report.json \
  --models CVTE-AUTO \
  --config ~/.workagent/config.json \
  --connection-slug cvte-gateway \
  --apply
```

这个命令会：

- 读取 report
- 生成 patch
- 把 patch 合并到 `cvte-gateway` 这条 connection 的 `capabilities`
- 原地写回 `~/.workagent/config.json`
- 打印 capability 变化摘要

限制：

- `--apply` 只能和 `--config` 一起用
- `--apply` 不能和 `--output` 一起用
- `--config` 必须同时带 `--connection-slug`

## Step 5: 验证配置是否生效

### 1. 检查配置文件

可以直接检查目标 connection：

```bash
jq '.llmConnections[] | select(.slug=="cvte-gateway") | {slug, capabilities}' ~/.workagent/config.json
```

### 2. 验证运行时行为

当前系统已经支持 connection-level capability override 生效：

- ClaudeAgent 会读取 connection `capabilities`
- routed model 会按 capability 决定是否使用 inline PDF / 其他能力
- 未声明的能力仍按保守默认处理

## 常用场景

### 场景 1: 给 `CVTE-AUTO` 补能力

```bash
bun run scripts/model-capability-probe.ts \
  --models CVTE-AUTO \
  --output ./tmp/cvte-auto-report.json

bun run scripts/model-capability-patch.ts \
  --report ./tmp/cvte-auto-report.json \
  --models CVTE-AUTO \
  --config ~/.workagent/config.json \
  --connection-slug cvte-gateway
```

确认预览没问题后：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/cvte-auto-report.json \
  --models CVTE-AUTO \
  --config ~/.workagent/config.json \
  --connection-slug cvte-gateway \
  --apply
```

### 场景 2: 只给某个 routed model 补能力，不影响其他 connection

直接用目标 connection 的 slug：

```bash
bun run scripts/model-capability-patch.ts \
  --report ./tmp/model-capability-report.json \
  --models glm-4.7 \
  --config ~/.workagent/config.json \
  --connection-slug cvte-gateway \
  --apply
```

这只会修改 `cvte-gateway` 这条 connection，不会动其他 connection。

## 回滚

最简单的回滚方式是恢复备份：

```bash
cp ~/.workagent/config.json.bak ~/.workagent/config.json
```

如果只想移除某个 model 的 capability，可以手工编辑对应 connection 的：

```json
{
  "capabilities": {
    "byModel": {
      "CVTE-AUTO": {
        "...": "..."
      }
    }
  }
}
```

## 已验证的行为

这套流程当前已经验证过：

- probe report -> patch 转换
- patch -> config 合并
- 只更新目标 `connectionSlug`
- `--apply` 才会写回
- `updateLlmConnection()` 不会再丢 `capabilities`
- ClaudeAgent 运行时会读取 connection-level capability override

## 当前边界

当前没有做的事情：

- 还没有 UI 入口
- 还没有自动把平台探测结果回填到 connection
- `supportsVision` 还没有 probe 自动推导

所以当前推荐流程仍然是：

1. 先 probe
2. 先 preview
3. 再 apply
4. 最后抽样验证运行时行为
