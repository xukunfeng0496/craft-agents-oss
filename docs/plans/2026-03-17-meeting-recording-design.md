# AI 会议记录功能设计文档

**日期：** 2026-03-17
**状态：** 设计阶段
**类型：** 新功能设计

## 概述

为 Work Agents 添加 AI 会议记录功能，支持录音、文字转写、会议总结和角色识别。该功能作为独立的会议记录工具集成到现有的 Session 系统中。

## 核心需求

1. **录音功能** - 本地录制会议音频（麦克风/系统音频）
2. **文字转写** - 调用第三方服务（火山引擎）将音频转为文字
3. **说话人识别** - 自动区分不同说话人，支持手动关联真实姓名
4. **会议总结** - 使用 AI 生成结构化的会议纪要
5. **Session 集成** - 作为特殊类型的 Session，复用现有架构

## 整体架构设计

### 三层架构

**UI 层（Electron Renderer）：**
- 快捷操作按钮：在输入框下方添加"🎙️ 会议记录"快捷按钮
- 录音控制面板：开始/暂停/停止按钮、音频波形、录音时长
- 转写结果展示：按说话人分段显示，支持编辑说话人姓名
- 会议管理：Meeting Session 在列表中有特殊图标和状态标识

**业务逻辑层（Main Process + Shared Package）：**
- 录音管理器：使用 Web Audio API 录制音频
- 转写服务：封装火山引擎 API 调用
- 会议数据管理：Session 元数据、音频文件、转写结果持久化
- AI 总结服务：基于 Skills 系统生成会议纪要

**存储层：**
- 会议数据存储在 `~/.workagent/workspaces/{workspace-id}/sessions/{session-id}/`
- 每个会议包含：`session.jsonl`、`metadata.json`、`audio.wav`、`transcript.json`、`speaker-mapping.json`

## Session 集成方案

### 会议记录作为特殊 Session 类型

**Session 元数据扩展：**
```typescript
interface SessionMetadata {
  sessionType: 'chat' | 'meeting'  // 新增字段
  // ... 其他字段
}
```

**Meeting Session 特征：**
- 自动添加 `meeting` 标签
- Session 列表显示特殊图标（🎙️）
- 标题格式：`会议记录 - YYYY-MM-DD HH:mm`
- 状态徽章：`录音中` / `转写中` / `已完成`

**输入区域适配：**
- 普通 Session：文本输入框 + 附件按钮
- Meeting Session：录音控制面板（开始/暂停/停止、波形、时长）
- 录音完成后切换为只读模式，显示转写结果

**消息流设计：**
1. 系统消息：录音开始/完成
2. AI 消息：转写结果（按说话人分段）
3. AI 消息：会议纪要（调用 Skill 生成）
4. 用户可继续对话，询问会议细节

**数据存储结构：**
```
~/.workagent/workspaces/{workspace-id}/sessions/{session-id}/
├── session.jsonl          # Session 消息流
├── metadata.json          # 包含 sessionType: 'meeting'
├── audio.wav              # 录音文件
├── transcript.json        # 转写结果（含说话人信息）
└── speaker-mapping.json   # 说话人ID到真实姓名的映射
```

## 录音与转写技术方案

### 录音实现

**音频源选择：**
- 麦克风输入（单人会议）
- 系统音频（在线会议录制，如 Zoom/Teams）
- 混合模式（麦克风 + 系统音频）

**录音参数：**
- 采样率：16000 Hz（火山引擎推荐）
- 声道：单声道（转写服务要求）
- 格式：WAV（无损，便于后续处理）
- 实时编码：边录边保存，避免内存溢出

**录音控制流程：**
```
开始录音 → 获取音频流 → 创建 MediaRecorder →
实时保存音频块 → 停止录音 → 合并音频文件 →
上传到云存储 → 提交转写任务
```

### 转写服务集成（火山引擎）

**API 调用流程：**
1. 提交任务：POST 音频 URL，获取 task_id
2. 轮询结果：每 30 秒查询一次转写状态
3. 解析结果：提取文本、时间戳、说话人信息

**说话人分离：**
- 启用 `enable_speaker_diarization` 参数
- 返回格式：`[{"speaker": "spk_0", "text": "...", "start": 1.2, "end": 3.5}]`
- 自动合并同一说话人的连续片段

**凭证管理：**
- 火山引擎 API Key 存储在 `credentials.enc`（加密）
- Credential type: `volcengine_asr`
- 在设置页面配置（AI Settings 或新增 Meeting Settings）

**错误处理：**
- 网络失败：自动重试 3 次
- 转写失败：保留原始音频，允许手动重试
- 配额超限：提示用户检查账户余额

## AI 总结与说话人管理

### 会议总结生成 - 基于 Skills

**预设 Skill：`meeting-summary`**

创建内置的会议总结 Skill，用户可直接使用或自定义：

```yaml
---
name: meeting-summary
description: 根据会议转写内容生成结构化的会议纪要
---

你是一个专业的会议记录助手。请根据以下会议转写内容生成结构化���会议纪要。

转写内容：
{{TRANSCRIPT}}

请按以下格式输出：

## 会议概要
[1-2句话总结会议主题和目的]

## 关键讨论点
- [要点1]
- [要点2]
- [要点3]

## 决策事项
- [决策1]
- [决策2]

## 待办事项
- [ ] [任务描述] (@负责人)
- [ ] [任务描述] (@负责人)

## 下一步行动
[后续需要跟进的事项]
```

**Skill 调用流程：**
1. 转写完成后，系统自动查找 `meeting-summary` Skill
2. 将转写文本作为 `{{TRANSCRIPT}}` 变量传入
3. 调用 Agent 执行 Skill，生成总结
4. 总结作为 AI 消息添加到 Meeting Session 中

**用户自定义：**
- 用户可在 Skills 页面编辑 `meeting-summary`
- 可调整输出格式、语言风格、侧重点
- 可创建多个变体：`meeting-summary-brief`（简短版）、`meeting-summary-detailed`（详细版）
- 在会议设置中选择使用哪个 Skill

**高级用法：**
- 支持多个 Skills 链式调用：
  - `meeting-summary` → 生成纪要
  - `meeting-action-items` → 提取待办事项
  - `meeting-risks` → 识别风险和问题
- 用户可在会议完成后手动触发特定 Skill

### 说话人管理功能

**自动识别阶段：**
- 转写结果返回 `spk_0`, `spk_1`, `spk_2` 等匿名标识
- UI 显示为"说话人 1"、"说话人 2"
- 每个说话人用不同颜色标识（从主题色派生）

**手动关联阶段：**
- 在转写结果上方显示"✏️ 编辑说话人"按钮
- 点击后弹出对话框，列出所有说话人
- 用户为每个说话人输入真实姓名
- 保存后，所有 `spk_0` 自动替换为真实姓名

**数据存储：**
```json
// speaker-mapping.json
{
  "spk_0": "张三",
  "spk_1": "李四",
  "spk_2": "王五"
}
```

## 用户界面详细设计

### 快速启动会议录音

**输入框下方的快捷按钮：**

在普通 Session 的输入框下方，添加快捷操作按钮（参考现有 Label 快捷选择的 UI 风格）：

```
┌─────────────────────────────────────────┐
│  Assign a task or ask anything          │
│  + 📎 💬                                 │
└─────────────────────────────────────────┘

  🎙️ 会议记录  📝 笔记  🔍 搜索
```

点击"🎙️ 会议记录"后：
- 创建新的 Meeting Session（自动添加 `meeting` 标签）
- 输入区域切换为录音控制面板

### 录音控制面板

**初始状态：**
```
┌─────────────────────────────────────────┐
│  🎙️ 会议录音                            │
│                                          │
│  [⏺ 开始录音]  音频源: 麦克风 ▼         │
│                                          │
│  或者                                    │
│  [📁 上传音频文件]                       │
└─────────────────────────────────────────┘
```

**录音中：**
```
┌─────────────────────────────────────────┐
│  [⏸ 暂停]  [⏹ 停止]                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  🎙️ 00:15:32  📊 ▮▮▮▮▮▮▯▯▯▯            │
└─────────────────────────────────────────┘
```

### 转写结果展示

**系统消息：**
```
┌─────────────────────────────────────────┐
│ 🤖 系统                        15:32     │
│ ✓ 录音已完成 (15:32)                    │
│ 正在上传并转写...                        │
│ [━━━━━━━━━━━━━━━━━━━━━━] 45%          │
└─────────────────────────────────────────┘
```

**转写结果：**
```
┌─────────────────────────────────────────┐
│ 🤖 转写结果                    15:35     │
│ [✏️ 编辑说话人] [🔄 重新生成总结]       │
│                                          │
│ 🔵 说话人 1  00:00 - 00:15              │
│ "大家好，今天我们讨论一下项目进度..."   │
│                                          │
│ 🟢 说话人 2  00:15 - 00:45              │
│ "好的，我这边的开发已经完成了..."       │
│                                          │
│ 🔵 说话人 1  00:45 - 01:20              │
│ "很好，那我们下一步..."                 │
└─────────────────────────────────────────┘
```

**会议纪要：**
```
┌─────────────────────────────────────────┐
│ 🤖 会议纪要 (@meeting-summary)  15:36   │
│                                          │
│ ## 会议概要                              │
│ 讨论项目开发进度和下一步计划             │
│                                          │
│ ## 关键讨论点                            │
│ - 开发工作已完成 80%                     │
│ - 测试阶段预计下周开始                   │
│ ...                                      │
└─────────────────────────────────────────┘
```

### 说话人编辑对话框

```
┌─────────────────────────────────────────┐
│  编辑说话人                        ✕    │
├─────────────────────────────────────────┤
│  🔵 说话人 1  →  [张三_____]            │
│  🟢 说话人 2  →  [李四_____]            │
│  🟡 说话人 3  →  [_________]            │
│                                          │
│              [取消]  [保存]              │
└─────────────────────────────────────────┘
```

### Session 列表显示

Meeting Session 在列表中有特殊样式：

```
🎙️ 会议记录 - 2026-03-17 15:00
   [录音中] 15:32 🔴

🎙️ 产品讨论会 - 2026-03-15 10:00
   [已完成] 45:20
   👥 张三、李四、王五
   meeting 标签
```

### 会议设置

在 Settings 页面新增 Meeting Settings 部分：

- **默认录音源**：麦克风 / 系统音频 / 混合
- **火山引擎 API 配置**：App ID、Access Token
- **默认总结 Skill**：选择使用哪个 Skill
- **自动总结**：录音完成后自动生成总结（开/关）
- **音频保留策略**：永久保留 / 转写后删除 / 30天后删除

## 数据流与技术实现

### 完整的数据流程

**1. 录音阶段：**
```
用户点击"会议记录"按钮
  ↓
创建 Meeting Session (sessionType: 'meeting')
  ↓
请求音频权限 (navigator.mediaDevices.getUserMedia)
  ↓
开始录音 → 实时保存音频块到临时文件
  ↓
停止录音 → 合并音频块 → 保存为 audio.wav
  ↓
添加系统消息："录音已完成 (时长)"
```

**2. 转写阶段：**
```
上传音频到云存储 (或使用本地 HTTP 服务器提供 URL)
  ↓
调用火山引擎 API 提交转写任务
  ↓
获取 task_id，开始轮询 (每 30 秒)
  ↓
转写完成 → 解析结果 (文本 + 说话人 + 时间戳)
  ↓
保存到 transcript.json
  ↓
添加 AI 消息：显示分段转写文本
```

**3. 总结阶段：**
```
查找 meeting-summary Skill
  ↓
构造 Prompt (将转写文本作为 {{TRANSCRIPT}} 变量)
  ↓
调用 Agent.chat() 执行 Skill
  ↓
生成会议纪要
  ↓
添加 AI 消息：显示会议纪要
```

### 核心模块设计

**1. 录音管理器 (`packages/shared/src/meeting/audio-recorder.ts`)：**
```typescript
class AudioRecorder {
  startRecording(source: 'microphone' | 'system' | 'mixed'): Promise<void>
  pauseRecording(): void
  stopRecording(): Promise<string> // 返回音频文件路径
  getAudioLevel(): number // 实时音量 (0-100)
  getDuration(): number // 录音时长（秒）
}
```

**2. 转写服务 (`packages/shared/src/meeting/transcription-service.ts`)：**
```typescript
class TranscriptionService {
  submitTask(audioUrl: string): Promise<string> // 返回 task_id
  queryResult(taskId: string): Promise<TranscriptResult | 'pending'>
  parseTranscript(result: any): TranscriptSegment[]
}

interface TranscriptSegment {
  speaker: string // 'spk_0', 'spk_1', ...
  text: string
  startTime: number
  endTime: number
}
```

**3. 会议数据管理 (`packages/shared/src/meeting/meeting-manager.ts`)：**
```typescript
class MeetingManager {
  createMeeting(workspaceId: string): Promise<Session>
  saveSpeakerMapping(sessionId: string, mapping: Record<string, string>): Promise<void>
  generateSummary(sessionId: string): Promise<void>
}
```

**4. IPC 接口 (`apps/electron/src/main/ipc.ts`)：**
- `MEETING_START_RECORDING` - 开始录音
- `MEETING_STOP_RECORDING` - 停止录音
- `MEETING_SUBMIT_TRANSCRIPTION` - 提交转写任务
- `MEETING_QUERY_TRANSCRIPTION` - 查询转写状态
- `MEETING_SAVE_SPEAKER_MAPPING` - 保存说话人映射
- `MEETING_GENERATE_SUMMARY` - 生成会议总结

## 工程复杂度评估

**评估结果：Just right**

**理由：**
- 充分复用现有 Session 架构，避免重复造轮子
- 录音功能使用标准 Web API，转写服务调用成熟的第三方 API
- 会议总结基于 Skills 系统，保持灵活性和可扩展性
- 没有引入不必要的抽象层或配置选项
- 每个功能都有明确的用户价值，没有"为了未来"的过度设计

## 实施计划

### Phase 1 - 核心功能（MVP）

**目标：** 实现基础的会议录音和转写功能

1. 扩展 Session 类型支持 `meeting`
   - 修改 `SessionMetadata` 接口
   - 更新 Session 创建逻辑

2. 实现基础录音功能（麦克风输入）
   - 创建 `AudioRecorder` 类
   - 实现录音控制 IPC 接口

3. 集成火山引擎转写 API
   - 创建 `TranscriptionService` 类
   - 实现任务提交和结果轮询

4. 创建 `meeting-summary` 预设 Skill
   - 编写 Skill YAML 文件
   - 集成到默认 Skills 中

5. 基础 UI 实现
   - 快捷按钮（输入框下方）
   - 录音控制面板
   - 转写结果展示

**预计工作量：** 5-7 天

### Phase 2 - 增强功能

**目标：** 完善用户体验和功能完整性

1. 说话人编辑功能
   - 编辑对话框 UI
   - 说话人映射存储和应用

2. 音频文件上传支持
   - 文件选择和验证
   - 上传到云存储或本地服务器

3. 系统音频录制（在线会议）
   - 使用 `desktopCapturer` API
   - 音频源选择 UI

4. 会议设置页面
   - 火山引擎 API 配置
   - 默认 Skill 选择
   - 音频保留策略

5. Session 列表特殊显示
   - Meeting 图标和状态
   - 参与人显示

**预计工作量：** 4-5 天

### Phase 3 - 优化体验

**目标：** 提升用户体验和功能扩展性

1. 实时音频波形可视化
2. 转写进度实时显示
3. 多个总结 Skill 支持
4. 会议搜索和过滤
5. 导出功能（Markdown、PDF）

**预计工作量：** 3-4 天

## 技术风险与缓解

**风险1：系统音频录制在不同平台的兼容性**
- **影响：** macOS、Windows、Linux 的系统音频捕获方式不同
- **缓解：** Phase 1 只支持麦克风，Phase 2 再处理系统音频；提供详细的平台兼容性文档

**风险2：火山引擎 API 配额和成本**
- **影响：** 用户可能因配额不足导致转写失败
- **缓解：** 在设置中显示用量统计；支持用户使用自己的 API Key；提供本地转写方案作为备选

**风险3：大音频文件的上传和存储**
- **影响：** 长时间会议产生大文件，影响上传速度和存储空间
- **缓解：** 限制单次录音时长（如 2 小时）；提供音频压缩选项；实现音频保留策略（自动清理）

**风险4：转写准确率依赖第三方服务**
- **影响：** 转写质量受限于火山引擎 API
- **缓解：** 允许用户手动编辑转写结果；支持多个转写服务提供商（未来扩展）

## 后续扩展方向

1. **多语言支持** - 支持英文、日语等多语言会议
2. **实时转写** - 边录音边转写，实时显示文本
3. **视频会议集成** - 直接集成 Zoom/Teams API
4. **会议模板** - 预设不同类型会议的总结模板
5. **协作功能** - 多人共同编辑会议纪要
6. **本地转写** - 使用 Whisper.cpp 实现离线转写

## 参考资料

- [火山引擎 - 豆包语音妙记 API 文档](https://www.volcengine.com/docs/6561/1798094)
- [火山引擎 - 大模型录音文件识别](https://www.volcengine.com/docs/6561/1354868)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)

