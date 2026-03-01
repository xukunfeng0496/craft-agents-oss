# Skill Variables Implementation

## 概述

Skill Variables 功能允许 skills 声明需要的配置变量，用户通过 UI 配置这些变量，skill 内容中的 `{{VAR_NAME}}` 占位符会在加载时被替换为实际值。

## 核心特性

✅ **已完成**：
- 变量声明（在 SKILL.md frontmatter 中）
- 加密存储（复用现有的 CredentialManager，AES-256-GCM）
- 变量替换（`{{VAR_NAME}}` → 实际值）
- 必填/可选变量支持
- 默认值支持
- 完整的测试覆盖

⏳ **待完成**：
- IPC 接口（Electron main ↔ renderer）
- UI 界面（Settings → Skills → Variables 配置页面）

## 使用方法

### 1. 在 Skill 中声明变量

在 `SKILL.md` 的 frontmatter 中添加 `vars` 字段：

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

### 2. 在 Skill 内容中使用变量

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

### 3. 编程接口

```typescript
import {
  getSkillVar,
  getSkillVars,
  setSkillVar,
  setSkillVars,
  substituteSkillVars,
  getUnsetRequiredVars,
} from '@work-agent/shared/skills';

// 获取单个变量
const apiKey = await getSkillVar(workspaceId, 'my-skill', 'API_KEY');

// 获取多个变量
const vars = await getSkillVars(workspaceId, 'my-skill', ['API_KEY', 'API_URL']);

// 设置变量
await setSkillVar(workspaceId, 'my-skill', 'API_KEY', 'sk-123');

// 批量设置
await setSkillVars(workspaceId, 'my-skill', {
  API_KEY: 'sk-123',
  API_URL: 'https://api.example.com',
});

// 替换占位符
const content = 'API: {{API_URL}}';
const substituted = substituteSkillVars(content, varDefinitions, varValues);

// 检查未设置的必填变量
const unset = getUnsetRequiredVars(varDefinitions, varValues);
if (unset.length > 0) {
  console.log(`Missing required variables: ${unset.join(', ')}`);
}
```

## 存储架构

变量存储在加密的凭证存储中：

- **存储位置**: `~/.workagent/credentials.enc`（AES-256-GCM 加密）
- **凭证 ID 格式**: `skill_var::{workspaceId}::{skillSlug}::{varName}`
- **示例**: `skill_var::ws-123::jiandaoyun::JDY_API_KEY`

这种设计的优点：
- ✅ 复用现有的加密基础设施
- ✅ 统一的凭证管理 API
- ✅ 所有变量都加密存储（包括非敏感信息）
- ✅ 支持多 workspace 隔离

## 变量替换规则

| 场景 | 行为 |
|------|------|
| 已设置的变量 | 替换为实际值 |
| 未设置的必填变量 | 保留 `{{VAR_NAME}}`（UI 会标记警告） |
| 未设置的可选变量（有默认值） | 替换为默认值 |
| 未设置的可选变量（无默认值） | 保留 `{{VAR_NAME}}` |

## 测试

运行测试：

```bash
bun test src/skills/__tests__/vars.test.ts
```

测试覆盖：
- ✅ 变量存储和检索
- ✅ 占位符替换
- ✅ 默认值处理
- ✅ 必填变量检测

## 示例

查看完整示例：`docs/examples/skill-with-variables/SKILL.md`

## 下一步

1. **IPC 接口**：在 Electron 中添加 IPC handlers
2. **UI 界面**：在 Settings → Skills 中添加变量配置界面
3. **Agent 集成**：在 skill 加载时自动进行变量替换
4. **错误提示**：当 skill 有未设置的必填变量时，在 UI 中显示警告

## 相关文件

- 设计文档: `docs/plans/2026-02-26-skill-variables-design.md`
- 类型定义: `packages/shared/src/skills/types.ts`
- 存储层: `packages/shared/src/skills/vars-storage.ts`
- 替换逻辑: `packages/shared/src/skills/vars-substitution.ts`
- 测试: `packages/shared/src/skills/__tests__/vars.test.ts`
- 示例: `docs/examples/skill-with-variables/SKILL.md`
