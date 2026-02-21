# TODO List

## 2026-02-21

### [UI] AI 设置页 - 自定义 API 模型选择改造

**位置:** `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

**需求描述:**

当用户配置「自定义 Claude API」时，将原来的模型 ID 文本输入框改造为可点击选择的模型选择器，同时保留手动输入的能力。

**详细功能点:**

1. **预设模型列表（可点击选择）**
   - 展示推荐模型列表，每个模型附带推荐理由说明
   - 默认预设模型：
     - `claude-sonnet-4-6` — 推荐：Claude 最新旗舰模型，能力强，速度均衡
     - `glm-4-5` — 推荐：国内可用，兼容 OpenAI API 格式，成本低
   - 选中状态高亮显示

2. **手动添加模型 ID**
   - 在列表底部提供输入框，允许用户手动输入任意模型 ID
   - 手动添加的模型出现在列表中，可选择

3. **逐个验证（Validate）**
   - 点击 Validate 按钮后，对已选/配置的模型列表**逐个**发送测试请求
   - 每个模型显示独立的验证状态（加载中 / 可用 ✓ / 不可用 ✗）
   - 验证通过的模型自动标记为可用

**相关文件:**
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — 主要改动
- `apps/electron/src/renderer/components/settings/SearchableModelInput.tsx` — 可能需要改造或替换
- `packages/shared/src/config/llm-connections.ts` — 模型配置存储
- `apps/electron/src/main/ipc.ts` — validate 接口可能需要扩展支持批量测试

---

### [Security] Viewer 无认证问题（代码审查 #2）

**位置:** `packages/relay-server/src/index.ts`, `apps/viewer/`

**问题描述:**

任何知道 relay server URL 的人都可以作为 viewer 连接并接收实时会话内容，无需任何认证。当前 relay server 仅支持可选的 `RELAY_SECRET`（用于 owner 写入鉴权），但 viewer 端完全开放。

**影响:**
- 会话内容（消息、文件、工具输出）可能被未授权方实时窥看
- 生产环境若未隔离 relay server 端口，存在数据泄露风险

**待讨论方案:**
- 方案A：生成一次性 viewer token，随 remote URL 一起分发，relay server 校验 token
- 方案B：时效性签名 URL（HMAC + expiry），无需 relay server 存储状态
- 方案C：保持现状，依赖网络层隔离（relay server 不对公网暴露）

**相关文件:**
- `packages/relay-server/src/index.ts` — viewer 连接入口，需加 token 校验
- `apps/electron/src/main/sessions.ts` — 生成 remote URL，需附带 token
- `apps/viewer/src/` — viewer 端需携带 token 发起连接

---

### [Performance] 快照发送频率优化（代码审查 #6）

**位置:** `apps/electron/src/main/sessions.ts`

**问题描述:**

每次 agent 触发 `onEvent` 时都会广播完整 session snapshot（包含所有历史消息）给 relay server 的所有 viewer。随着会话消息增多，快照体积越来越大，导致带宽和处理开销线性增长。

**影响:**
- 长会话中每条消息触发数十KB甚至数百KB的传输
- relay server 需处理并转发大量冗余数据

**待讨论方案:**
- 方案A：增量更新 — 只发送变更的 delta，viewer 本地累积重建状态
- 方案B：节流/防抖 — 限制快照发送频率（如最多每500ms一次）
- 方案C：分离频道 — 实时事件走轻量频道，全量快照按需拉取

**相关文件:**
- `apps/electron/src/main/sessions.ts` — `buildStoredSession()` 调用处

---

### [Bug] Skills 双重注入隐患（代码审查 #11）

**位置:** `packages/shared/src/agent/base-agent.ts`

**问题描述:**

Skills 内容可能被注入两次：一次通过 system prompt，一次通过 agent SDK 的 skills 机制。若两套机制同时激活，会导致 agent 接收到重复指令，浪费 token 并可能造成行为混乱。

**影响:**
- Token 浪费（重复内容占用 context window）
- 潜在的指令冲突或优先级混乱

**待分析:**
- 确认当前 skills 注入路径：system prompt 注入 vs SDK skills 参数
- 确认两者是否互斥或同时激活
- 若确认重复，选择保留一种机制并移除另一种

**相关文件:**
- `packages/shared/src/agent/base-agent.ts` — skills 注入逻辑
- `packages/shared/src/agent/craft-agent.ts` — SDK 调用参数

---

### [UI] AI 设置页 - Claude API 秘钥配置，将 Custom 移到第一选项

**位置:** `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

**需求描述:**

在配置 Claude API 秘钥的选项列表中，将「Custom（自定义）」选项调整为**第一个**，作为默认展示项。

**相关文件:**
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — 调整选项排序
