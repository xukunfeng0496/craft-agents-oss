# Skill Variables - UI Layer Implementation

## 完成状态

✅ **IPC 接口层** - 完成
✅ **UI 组件** - 完成
✅ **集成到 Skill Info Page** - 完成

## 实现的功能

### 1. IPC Channels (`apps/electron/src/shared/types.ts`)

添加了三个新的 IPC channels：

```typescript
SKILL_VARS_GET: 'skills:vars:get',      // 获取变量值
SKILL_VARS_SET: 'skills:vars:set',      // 设置变量值
SKILL_VARS_DELETE: 'skills:vars:delete', // 删除变量值
```

### 2. IPC Handlers (`apps/electron/src/main/ipc.ts`)

实现了三个 IPC handlers：

- **SKILL_VARS_GET**: 获取指定 skill 的所有变量值
- **SKILL_VARS_SET**: 批量设置变量值
- **SKILL_VARS_DELETE**: 批量删除变量值

所有 handlers 都使用 `@work-agent/shared/skills` 模块的函数，数据存储在加密的凭证存储中。

### 3. Preload API (`apps/electron/src/preload/index.ts`)

暴露了三个 API 给 renderer 进程：

```typescript
window.electronAPI.getSkillVars(workspaceId, skillSlug, varNames)
window.electronAPI.setSkillVars(workspaceId, skillSlug, vars)
window.electronAPI.deleteSkillVars(workspaceId, skillSlug, varNames)
```

### 4. UI 组件 (`apps/electron/src/renderer/components/skills/SkillVariablesSection.tsx`)

创建了 `SkillVariablesSection` 组件，提供：

**功能**：
- 显示所有变量定义（从 skill metadata 读取）
- 加载当前变量值（从加密存储读取）
- 输入框用于编辑变量值
- 实时显示未配置的必填变量数量
- 保存按钮（仅在有修改时启用）
- 成功/失败提示

**UI 特性**：
- 必填变量标记（红色星号）
- 已配置变量显示绿色勾号
- 可选变量显示默认值提示
- 未配置必填变量时显示警告横幅
- 使用 monospace 字体显示变量值（适合 API keys 等）
- 支持 placeholder 和 example 提示

### 5. 集成到 Skill Info Page (`apps/electron/src/renderer/pages/SkillInfoPage.tsx`)

在 Skill Info Page 中添加了 Variables 区域：

- 位置：Metadata 区域之后，Permission Modes 之前
- 仅当 skill 定义了变量时才显示
- 自动加载和保存变量值
- 与其他区域保持一致的样式

## 使用流程

### 1. 创建带变量的 Skill

在 `SKILL.md` 的 frontmatter 中定义变量：

```yaml
---
name: My API Skill
description: Connects to external API
vars:
  - name: API_BASE_URL
    description: Base URL for the API
    required: true
    example: "https://api.example.com"
  - name: API_KEY
    description: API authentication key
    required: true
  - name: ENVIRONMENT
    description: Deployment environment
    required: false
    default: "production"
---
```

### 2. 配置变量

1. 打开 Skill Info Page（点击 skill 查看详情）
2. 找到 "Variables" 区域
3. 填写变量值
4. 点击 "Save" 按钮

### 3. 在 Skill 内容中使用变量

使用 `{{VAR_NAME}}` 占位符：

```markdown
## Usage

Make API requests to {{API_BASE_URL}}:

\`\`\`bash
curl -X GET "{{API_BASE_URL}}/users" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "X-Environment: {{ENVIRONMENT}}"
\`\`\`
```

### 4. Agent 加载 Skill 时自动替换

当 agent 加载 skill 时，系统会：

1. 读取 skill 的变量定义
2. 从加密存储中读取变量值
3. 使用 `substituteSkillVars()` 替换占位符
4. 将替换后的内容传递给 agent

## 数据流

```
┌─────────────────────────────────────────────────────────────┐
│ Skill SKILL.md (frontmatter)                                 │
│ vars:                                                        │
│   - name: API_KEY                                           │
│     required: true                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ UI: SkillVariablesSection                                    │
│ - Display variable definitions                              │
│ - Input fields for values                                   │
│ - Save button                                               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (Save)
┌─────────────────────────────────────────────────────────────┐
│ IPC: SKILL_VARS_SET                                          │
│ window.electronAPI.setSkillVars(ws, skill, vars)            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Main Process: IPC Handler                                    │
│ setSkillVars(workspaceId, skillSlug, vars)                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Storage: CredentialManager                                   │
│ skill_var::{workspaceId}::{skillSlug}::{varName}            │
│ Encrypted with AES-256-GCM                                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (Load)
┌─────────────────────────────────────────────────────────────┐
│ Agent: Load Skill                                            │
│ 1. Read skill metadata (vars definitions)                   │
│ 2. Load variable values from storage                        │
│ 3. substituteSkillVars(content, defs, values)              │
│ 4. Pass substituted content to agent                        │
└─────────────────────────────────────────────────────────────┘
```

## 安全性

- ✅ 所有变量值都加密存储（AES-256-GCM）
- ✅ 使用现有的 CredentialManager，无需额外的安全机制
- ✅ 支持 workspace 隔离（不同 workspace 的变量互不影响）
- ✅ 敏感信息（API keys）和非敏感信息（URLs）统一加密

## 待完成的工作

### Agent 集成

需要在 agent 加载 skill 时自动进行变量替换：

1. **位置**: `packages/shared/src/agent/` 或 skill 加载逻辑中
2. **实现**:
   ```typescript
   import { substituteSkillVars, getSkillVars, getUnsetRequiredVars } from '@work-agent/shared/skills'

   // Load skill
   const skill = loadSkillBySlug(workspaceRoot, skillSlug, projectRoot)

   // Load variable values
   const varNames = skill.metadata.vars?.map(v => v.name) || []
   const varValues = await getSkillVars(workspaceId, skillSlug, varNames)

   // Check for unset required variables
   const unset = getUnsetRequiredVars(skill.metadata.vars, varValues)
   if (unset.length > 0) {
     // Show warning or error to user
     console.warn(`Skill ${skillSlug} has unset required variables: ${unset.join(', ')}`)
   }

   // Substitute variables
   const substitutedContent = substituteSkillVars(
     skill.content,
     skill.metadata.vars,
     varValues
   )

   // Use substitutedContent instead of skill.content
   ```

### UI 增强（可选）

1. **变量类型支持**:
   - 添加 `type` 字段（text, password, url, number）
   - password 类型使用密码输入框
   - url 类型添加验证

2. **批量导入/导出**:
   - 导出变量配置为 JSON
   - 从 JSON 导入变量配置
   - 方便在不同环境间迁移

3. **变量验证**:
   - URL 格式验证
   - 必填字段验证
   - 自定义验证规则

4. **Skills 列表页面**:
   - 显示哪些 skills 有未配置的必填变量
   - 添加警告图标

## 测试

运行测试：

```bash
# 核心功能测试
bun test src/skills/__tests__/vars.test.ts

# 类型检查
cd packages/shared && bun run tsc --noEmit
```

## 文件清单

### 核心层（已完成）
- ✅ `packages/shared/src/credentials/types.ts` - 添加 skill_var 类型
- ✅ `packages/shared/src/skills/types.ts` - 添加 SkillVariable 接口
- ✅ `packages/shared/src/skills/vars-storage.ts` - 存储 API
- ✅ `packages/shared/src/skills/vars-substitution.ts` - 替换逻辑
- ✅ `packages/shared/src/skills/storage.ts` - 解析 vars frontmatter
- ✅ `packages/shared/src/skills/__tests__/vars.test.ts` - 测试

### IPC 层（已完成）
- ✅ `apps/electron/src/shared/types.ts` - IPC channels
- ✅ `apps/electron/src/main/ipc.ts` - IPC handlers
- ✅ `apps/electron/src/preload/index.ts` - Preload API

### UI 层（已完成）
- ✅ `apps/electron/src/renderer/components/skills/SkillVariablesSection.tsx` - 变量配置组件
- ✅ `apps/electron/src/renderer/pages/SkillInfoPage.tsx` - 集成到详情页

### 文档
- ✅ `docs/plans/2026-02-26-skill-variables-design.md` - 设计文档
- ✅ `docs/skill-variables-implementation.md` - 实现说明
- ✅ `docs/examples/skill-with-variables/SKILL.md` - 示例 skill
- ✅ `docs/skill-variables-ui-implementation.md` - UI 实现文档（本文件）

## 总结

Skill Variables 功能的 UI 层已经完全实现，包括：

1. ✅ 完整的 IPC 通信层
2. ✅ 功能完善的 UI 组件
3. ✅ 与现有页面的无缝集成
4. ✅ 加密存储支持
5. ✅ 用户友好的交互体验

剩余工作主要是在 agent 加载 skill 时集成变量替换逻辑，这部分相对简单，只需要在合适的位置调用已有的 API 即可。
