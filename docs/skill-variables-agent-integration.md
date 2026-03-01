# Skill Variables - Agent Integration Guide

## 概述

本文档说明如何在 agent 中集成 skill variables 功能，使得 agent 在使用 skills 时能够自动替换变量。

## 集成方案

由于 Claude Agent SDK 通过 `plugins` 参数直接加载 skill 目录，我们有以下几种集成方案：

### 方案 A：System Prompt 提示（推荐 - 最简单）

在 system prompt 中添加变量配置信息，让 agent 知道哪些变量已配置。

**优点**：
- ✅ 实现简单，不需要修改 SDK 集成
- ✅ Agent 可以主动提示用户配置变量
- ✅ 不影响现有的 skill 加载流程

**缺点**：
- ❌ 变量不会自动替换，需要 agent 手动处理
- ❌ 依赖 agent 的理解能力

**实现位置**：`packages/shared/src/prompts/system.ts`

```typescript
import { loadAllSkills, processAllSkillVariables } from '../skills/index.ts';

// 在 getSystemPrompt 函数中添加
async function addSkillVariablesContext(workspaceId: string, workspaceRoot: string, projectRoot?: string) {
  // Load all skills
  const skills = loadAllSkills(workspaceRoot, projectRoot);

  // Process variables
  const processed = await processAllSkillVariables(skills, workspaceId);

  // Find skills with unset required variables
  const skillsNeedingConfig = processed.filter(s => s.unsetRequired && s.unsetRequired.length > 0);

  if (skillsNeedingConfig.length === 0) {
    return '';
  }

  // Generate warning text
  const warnings = skillsNeedingConfig.map(skill => {
    const varList = skill.unsetRequired!.map(v => `\`${v}\``).join(', ');
    return `- **${skill.metadata.name}** (\`${skill.slug}\`): requires ${varList}`;
  }).join('\n');

  return `
## Skill Variables Configuration

The following skills require variable configuration before use:

${warnings}

When a user tries to use these skills, inform them that variables need to be configured in Settings → Skills.
`;
}
```

### 方案 B：Pre-Tool-Use Hook（推荐 - 最完整）

在 `pre-tool-use` hook 中拦截 Skill tool 调用，检查变量配置状态。

**优点**：
- ✅ 可以在 skill 执行前检查变量
- ✅ 可以阻止未配置的 skill 执行
- ✅ 提供清晰的错误信息

**缺点**：
- ❌ 仍然无法替换 skill 内容中的变量
- ❌ 需要修改 pre-tool-use 逻辑

**实现位置**：`packages/shared/src/agent/core/pre-tool-use.ts`

```typescript
import { loadSkillBySlug, processSkillVariables, generateVariableWarning } from '../../skills/index.ts';

// 在 qualifySkillName 函数后添加变量检查
async function checkSkillVariables(
  workspaceId: string,
  workspaceRoot: string,
  skillSlug: string,
  projectRoot?: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Load skill
  const skill = loadSkillBySlug(workspaceRoot, skillSlug, projectRoot);
  if (!skill) {
    return { allowed: true }; // Skill not found, let SDK handle it
  }

  // Check if skill has variables
  if (!skill.metadata.vars || skill.metadata.vars.length === 0) {
    return { allowed: true }; // No variables, allow execution
  }

  // Process variables
  const result = await processSkillVariables(skill, workspaceId);

  // Check for unset required variables
  if (result.unsetRequired.length > 0) {
    const warning = generateVariableWarning(skillSlug, result.unsetRequired);
    return {
      allowed: false,
      reason: warning,
    };
  }

  return { allowed: true };
}

// 在 preToolUse 函数中调用
if (input.tool_name === 'Skill') {
  const skillSlug = extractSkillSlug(input.skill);
  const varCheck = await checkSkillVariables(
    workspaceId,
    workspaceRoot,
    skillSlug,
    projectRoot
  );

  if (!varCheck.allowed) {
    return {
      ...input,
      blocked: true,
      blockReason: varCheck.reason,
    };
  }
}
```

### 方案 C：动态生成处理后的 Skill 文件（最完整但最复杂）

在 agent 启动时，为所有有变量的 skills 生成处理后的版本。

**优点**：
- ✅ 完全透明，SDK 看到的就是替换后的内容
- ✅ 变量自动替换，无需 agent 理解

**缺点**：
- ❌ 实现复杂，需要管理临时文件
- ❌ 需要在每次变量更新时重新生成
- ❌ 可能影响性能

**实现位置**：`packages/shared/src/agent/claude-agent.ts`

```typescript
import { loadAllSkills, createProcessedSkillFile } from '../skills/index.ts';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// 在 chat() 方法中，SDK 初始化之前
async function prepareProcessedSkills(workspaceId: string, workspaceRoot: string, projectRoot?: string) {
  // Load all skills
  const skills = loadAllSkills(workspaceRoot, projectRoot);

  // Filter skills with variables
  const skillsWithVars = skills.filter(s => s.metadata.vars && s.metadata.vars.length > 0);

  if (skillsWithVars.length === 0) {
    return null; // No skills with variables
  }

  // Create temp directory for processed skills
  const tempDir = mkdtempSync(join(tmpdir(), 'workagent-skills-'));

  // Process each skill
  await Promise.all(
    skillsWithVars.map(skill =>
      createProcessedSkillFile(skill, workspaceId, tempDir)
    )
  );

  return tempDir;
}

// 使用处理后的目录
const processedSkillsDir = await prepareProcessedSkills(
  this.config.workspaceId,
  this.workspaceRootPath,
  this.config.session?.workingDirectory
);

// 修改 plugins 配置
plugins: [
  // 如果有处理后的 skills，优先使用
  ...(processedSkillsDir ? [{ type: 'local' as const, path: processedSkillsDir }] : []),
  { type: 'local' as const, path: this.workspaceRootPath },
  // ... 其他 plugin 目录
],
```

## 推荐实现顺序

1. **第一阶段**：实现方案 A（System Prompt 提示）
   - 最简单，立即可用
   - 让用户知道哪些 skills 需要配置

2. **第二阶段**：实现方案 B（Pre-Tool-Use Hook）
   - 提供更好的用户体验
   - 阻止未配置的 skills 执行

3. **第三阶段**（可选）：实现方案 C（动态生成）
   - 完全自动化
   - 需要更多测试和优化

## 示例代码

### 在 System Prompt 中添加变量信息

```typescript
// packages/shared/src/prompts/system.ts

export async function getSystemPrompt(options: SystemPromptOptions): Promise<string> {
  // ... 现有代码 ...

  // Add skill variables context
  const skillVarsContext = await addSkillVariablesContext(
    options.workspaceId,
    options.workspaceRoot,
    options.projectRoot
  );

  return `
${basePrompt}

${skillVarsContext}

${otherContext}
`;
}
```

### 在 Pre-Tool-Use 中检查变量

```typescript
// packages/shared/src/agent/core/pre-tool-use.ts

export async function preToolUse(input: ToolInput, context: PreToolUseContext) {
  // ... 现有代码 ...

  // Check skill variables
  if (input.tool_name === 'Skill') {
    const varCheck = await checkSkillVariables(
      context.workspaceId,
      context.workspaceRoot,
      input.skill,
      context.projectRoot
    );

    if (!varCheck.allowed) {
      return {
        ...input,
        blocked: true,
        blockReason: varCheck.reason,
      };
    }
  }

  return input;
}
```

## 测试

创建测试 skill：

```yaml
---
name: Test API Skill
description: Test skill with variables
vars:
  - name: API_KEY
    description: API Key
    required: true
  - name: API_URL
    description: API URL
    required: false
    default: "https://api.example.com"
---

# Test Skill

Use {{API_KEY}} to authenticate with {{API_URL}}.
```

测试步骤：

1. 创建上述 skill
2. 不配置变量，尝试使用 skill
3. 应该看到警告信息
4. 配置变量后再次尝试
5. 应该正常工作

## 总结

- ✅ 核心功能已完成（存储、替换、UI）
- ⏳ Agent 集成需要选择合适的方案
- 📝 推荐先实现方案 A（System Prompt），简单且有效
- 🚀 后续可以逐步实现方案 B 和 C，提供更好的体验
