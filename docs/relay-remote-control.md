# Relay Remote Control 架构文档

## 概述

Remote Control 功能允许桌面 Electron 应用将一个 session 的实时状态共享给浏览器 viewer，viewer 可以观看 session 进展，也可以直接发送消息、回答 Agent 的问题、切换权限模式等——形成完整的双向交互。

**技术栈：**
- 中继服务（Relay Server）：独立的 WebSocket 服务，负责转发消息，Electron 和浏览器分别作为 `owner` 和 `viewer` 角色接入
- Electron 主进程：`sessions.ts` 中的 `startRemoteControl()` / `stopRemoteControl()`
- 浏览器 Viewer：`apps/viewer/src/components/RemoteControlViewer.tsx`

---

## 架构总览

```
┌─────────────────────────────────────────────┐
│              Electron App                   │
│                                             │
│  Agent → SessionManager.sendEvent()         │
│           │                                 │
│           ├──→ IPC → Electron Renderer      │
│           └──→ remoteWs.send() ──────────┐  │
└──────────────────────────────────────────┼──┘
                                           │
                                    ┌──────▼──────┐
                                    │ Relay Server │
                                    │  WebSocket   │
                                    └──────┬──────┘
                                           │
                              ┌────────────▼───────────┐
                              │   Browser Viewer App    │
                              │  RemoteControlViewer    │
                              │  ws.onmessage → state   │
                              └─────────────────────────┘
```

Viewer 发送命令时方向反转：

```
Browser Viewer → ws.send(cmd) → Relay Server → remoteWs.onmessage → SessionManager
```

---

## 环境变量配置

### Electron 主进程（`sessions.ts`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_URL` | `ws://localhost:4747` | Relay Server 的 WebSocket 地址 |
| `RELAY_SECRET` | `""` | 可选的鉴权密钥，设置后作为 `x-relay-secret` header 发送 |
| `RELAY_PUBLIC_BASE` | `http://localhost:5173` | 生成分享 URL 时使用的公开基础地址 |

`RELAY_HTTP_URL` 由 `RELAY_URL` 自动派生（`ws://` → `http://`，`wss://` → `https://`）。

### Viewer App（`apps/viewer/src/App.tsx`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_RELAY_WS_URL` | `ws://localhost:4747` | Relay Server 的 WebSocket 地址（Viewer 侧） |

---

## 启动流程（Owner 侧）

`SessionManager.startRemoteControl(sessionId)` 的执行步骤：

1. **创建 Room**：向 `POST {RELAY_HTTP_URL}/rooms` 发请求，获得 `roomId`
2. **连接 Relay**：以 `role=owner` 连接 `{RELAY_URL}/rooms/{roomId}/ws?role=owner`
3. **注册消息处理**：`ws.onmessage` 处理来自 viewer 的命令（见下文）
4. **发送初始快照**：调用 `loadStoredSession` 加载完整 session 数据，发送 `session_snapshot` 消息
5. **持久化**：将 `remoteRoomId` / `remoteUrl` 写入 session metadata；发送 `remote_control_started` IPC 事件通知 renderer

分享 URL 格式：`{RELAY_PUBLIC_BASE}/s/r/{roomId}`

---

## Viewer 侧路由

`apps/viewer/src/App.tsx`：

- `/s/{id}` — 查看已共享的静态 session（只读，通过 `/s/api/{id}` 拉取）
- `/s/r/{roomId}` — Remote Control viewer（实时，通过 Relay WebSocket）

Room ID 格式：16 个十六进制字符，正则 `/^\/s\/r\/([a-f0-9]{16})$/`。

---

## WebSocket 消息协议

所有消息均为 JSON 格式。

### Owner → Relay → Viewer（服务端推送）

#### `session_snapshot`
初始化或完整刷新 session 状态。在以下时机发送：
- Owner 连接后立即发送一次（初始快照）
- 每次 `complete` 事件后（turn 完成）
- 每次 `user_message` 事件后（新用户消息）

```json
{
  "type": "session_snapshot",
  "session": { /* StoredSession 完整对象 */ },
  "config": {
    "permissionMode": "ask",
    "thinkingLevel": "think",
    "model": "claude-opus-4-5",
    "connectionLocked": false,
    "isProcessing": false,
    "availableModels": [
      { "id": "claude-opus-4-5", "name": "Opus 4.5" }
    ]
  }
}
```

`config` 由 `buildRemoteConfig()` 构造，包含当前 session 的运行时配置。

#### SessionEvent 透传
除 `session_snapshot` 外，`sendEvent()` 方法会将所有 `SessionEvent` 原样转发到 Relay：

```typescript
// sessions.ts - sendEvent()
if (relayManaged?.remoteWs?.readyState === WebSocket.OPEN) {
  relayManaged.remoteWs.send(JSON.stringify(event))
  // complete / user_message 时额外发送 session_snapshot
}
```

Viewer 侧目前处理的事件类型：

| 事件类型 | Viewer 处理 |
|----------|------------|
| `session_snapshot` | 重置完整 session 状态和 config |
| `text_delta` | `isAgentTyping = true`，`config.isProcessing = true` |
| `complete` | `isAgentTyping = false`，`config.isProcessing = false` |
| `permission_mode_changed` | 更新 `config.permissionMode` |
| `session_model_changed` | 更新 `config.model` |
| `user_question_request` | 加入 `pendingQuestions` 队列，显示问题卡片 |
| `question_answered` | 从 `pendingQuestions` 中移除对应 requestId |

---

### Viewer → Relay → Owner（客户端命令）

Viewer 通过 `sendWsCommand(cmd)` 发送，Owner 在 `ws.onmessage` 中处理：

#### `send_message`
发送用户消息（可附带文件附件）。

```json
{
  "type": "send_message",
  "content": "用户输入的文本",
  "attachments": [
    {
      "type": "image",
      "name": "screenshot.png",
      "mimeType": "image/png",
      "base64": "...",
      "size": 12345
    }
  ]
}
```

`attachments` 为可选。`type` 可以是 `image` | `pdf` | `text` | `unknown`。

#### `set_permission_mode`
切换 session 权限模式。

```json
{
  "type": "set_permission_mode",
  "mode": "ask"
}
```

有效值：`"safe"` | `"ask"` | `"allow-all"`

#### `set_thinking_level`
切换思考级别。

```json
{
  "type": "set_thinking_level",
  "level": "think"
}
```

有效值：`"off"` | `"think"` | `"max"`

#### `set_model`
切换当前使用的模型。

```json
{
  "type": "set_model",
  "model": "claude-haiku-4-5"
}
```

`model` 可以为 `null`（重置为默认）。

#### `respond_to_question`
回答 Agent 的 `AskUserQuestion` 请求（双向同步机制，见下文）。

```json
{
  "type": "respond_to_question",
  "requestId": "req-abc123",
  "answers": {
    "0": ["选项 A"],
    "1": ["自定义文本"]
  }
}
```

`answers` 的 key 是问题索引（字符串），value 是选中的标签数组。选择 "Other" 时，value 为用户输入的自由文本。

---

## AskUserQuestion 双向同步机制

这是最复杂的交互场景，需要 Electron App 和 Viewer 两侧保持同步。

### 事件流

```
Agent 调用 AskUserQuestion
  ↓
SessionManager.sendEvent({ type: 'user_question_request', request: {...} })
  ├── IPC → Electron Renderer → 显示问题卡片（pendingQuestions）
  └── Relay → Viewer → 显示问题卡片（pendingQuestions）

--- 情形 A：App 用户回答 ---
Electron Renderer 调用 respondToQuestion() IPC
  → sessions.ts: agent.respondToQuestion()
  → sessions.ts: sendEvent({ type: 'question_answered', requestId })
      ├── IPC → Electron Renderer → 移除 pendingQuestions 中对应项
      └── Relay → Viewer → 移除 pendingQuestions 中对应项

--- 情形 B：Viewer 用户回答 ---
Viewer 发送 { type: 'respond_to_question', requestId, answers }
  → sessions.ts ws.onmessage → respondToQuestion()
  → sessions.ts: agent.respondToQuestion()
  → sessions.ts: sendEvent({ type: 'question_answered', requestId })
      ├── IPC → Electron Renderer → 移除 pendingQuestions 中对应项
      └── Relay → Viewer → 移除 pendingQuestions 中对应项（乐观更新已先移除）
```

### 乐观更新

Viewer 在发送 `respond_to_question` 命令后会立即乐观地移除第一个问题（`setPendingQuestions(prev => prev.slice(1))`），不等待 `question_answered` 确认，确保 UI 即时响应。`question_answered` 到来时若对应项已不存在则为空操作（no-op）。

### Electron App 的双重移除保护

Electron renderer 中：
- `handleRespondToQuestion()`：调用 IPC 后立即移除队列第一项（乐观更新）
- `question_answered` 事件处理器：按 `requestId` 过滤移除（精确匹配）

两者协同工作，本地回答时乐观更新优先，再由事件确认；viewer 回答时仅由事件触发移除。

---

## 共享 UI 组件：UserQuestionCard

`packages/ui/src/components/chat/UserQuestionCard.tsx`

设计为平台无关（platform-agnostic），可同时用于：
- Electron App（通过 `UserQuestionRequest.tsx` 包装）
- Viewer（直接在 `RemoteControlViewer.tsx` 中使用）

```typescript
interface UserQuestionCardProps {
  request: {
    requestId: string
    sessionId: string
    questions: UserQuestion[]
  }
  onSubmit: (requestId: string, answers: Record<string, string[]>) => void
  unstyled?: boolean
}
```

特点：
- 无 i18n 依赖（使用硬编码英文）
- 无 Electron 特定依赖
- 支持单选（radio 样式）和多选（checkbox 样式）
- 内置 "Other" 自由文本选项
- 可折叠面板，问题区域可滚动

---

## Relay Server 接口规范

Relay Server 是独立部署的服务（非本仓库代码），本文档仅描述其对外接口：

### HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST /rooms` | 创建新 room，返回 `{ roomId: string }` | 需要 `x-relay-secret` header（如配置） |

### WebSocket

连接格式：`ws://{host}/rooms/{roomId}/ws?role={owner|viewer}`

- `role=owner`：消息转发给所有 viewer；接收来自 viewer 的消息
- `role=viewer`：消息转发给 owner；接收来自 owner 的广播

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `apps/electron/src/main/sessions.ts` | Remote control 核心逻辑：`startRemoteControl`、`stopRemoteControl`、`respondToQuestion`（含 `question_answered` 事件发送）、`sendEvent`（Relay 转发）、`buildRemoteConfig` |
| `apps/viewer/src/components/RemoteControlViewer.tsx` | Viewer UI：WebSocket 连接管理、消息处理、渲染 session + 工具栏 + 输入框 + 问题卡片 |
| `apps/viewer/src/App.tsx` | 路由：`/s/r/{roomId}` → RemoteControlViewer，`/s/{id}` → 静态 viewer |
| `packages/ui/src/components/chat/UserQuestionCard.tsx` | 共享问题卡片 UI 组件 |
| `apps/electron/src/renderer/components/app-shell/input/structured/UserQuestionRequest.tsx` | Electron 端包装器，适配 `onResponse` 签名 |
| `apps/electron/src/shared/types.ts` | `SessionEvent` 类型定义，含 `user_question_request` 和 `question_answered` |
