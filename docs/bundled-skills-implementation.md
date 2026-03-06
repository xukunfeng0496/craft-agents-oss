# Bundled Skills Implementation

## 概述

将预装的 skills 打包到应用中，在创建 workspace 时自动安装到 workspace 的 skills 目录，无需手动安装。支持 Windows 和 macOS。

## 实现方案

### 1. 目录结构

```
apps/electron/
├── resources/
│   └── bundled-skills/          # 预装的 skills
│       ├── agent-browser/
│       ├── claude-mem/
│       ├── deep-research/
│       └── ...
├── src/main/
│   └── bundled-skills.ts        # 初始化逻辑
└── scripts/
    └── test-bundled-skills.cjs  # 测试脚本
```

### 2. 核心文件

#### `apps/electron/src/main/bundled-skills.ts`

负责将 bundled skills 复制到 workspace 的 skills 目录：

- `initializeBundledSkills(workspaceRoot)` - 主初始化函数
- `reinstallBundledSkills(workspaceRoot)` - 强制重新安装（用于调试）
- 跳过已存在的 skills（保护用户修改）

#### 调用位置

**1. 默认 workspace 创建** (`apps/electron/src/main/index.ts`):
```typescript
// 创建默认 workspace 后立即初始化 skills
const defaultPath = join(getDefaultWorkspacesDir(), 'my-workspace')
addWorkspace({ rootPath: defaultPath, name: 'My Workspace' })
initializeBundledSkills(defaultPath)
```

**2. 用户创建 workspace** (`apps/electron/src/main/ipc.ts`):
```typescript
ipcMain.handle(IPC_CHANNELS.CREATE_WORKSPACE, async (_event, folderPath: string, name: string) => {
  const workspace = addWorkspace({ name, rootPath: folderPath })
  initializeBundledSkills(folderPath)
  return workspace
})
```

#### `apps/electron/electron-builder.yml`

将 bundled skills 打包到应用中：

```yaml
files:
  - resources/bundled-skills/**/*
```

### 3. 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Build Time                                                │
│    electron-builder 将 resources/bundled-skills/ 打包到应用  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. App Startup                                               │
│    检查所有现有 workspace                                     │
│    └─ 如果 workspace 没有 skills 或 skills 很少              │
│       └─ 自动安装 bundled skills                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Workspace Creation                                        │
│    用户创建新 workspace 或首次启动创建默认 workspace         │
│    └─ initializeBundledSkills(workspaceRoot)                │
│       └─ 复制所有 skills 到 {workspace}/skills/            │
│       └─ 跳过已存在的 skills（保护用户修改）                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Skills 可用                                               │
│    Skills 出现在 workspace 的 skills 目录中                  │
│    用户可以在应用中使用这些 skills                           │
└─────────────────────────────────────────────────────────────┘
```

### 4. 跨平台兼容性

#### macOS
- Bundled skills 路径: `app.asar/resources/bundled-skills/`
- 安装目标: `~/.workagent/workspaces/{workspace-name}/skills/`

#### Windows
- Bundled skills 路径: `resources/app/resources/bundled-skills/`
- 安装目标: `%USERPROFILE%\.workagent\workspaces\{workspace-name}\skills\`
- 注意事项：
  - 已清理 `.DS_Store` 文件
  - 已清理 `__pycache__` 目录
  - 使用 `-X` 参数创建 zip 避免扩展属性问题

#### Linux
- Bundled skills 路径: `resources/app/resources/bundled-skills/`
- 安装目标: `~/.workagent/workspaces/{workspace-name}/skills/`

### 5. 测试

运行测试脚本验证 bundled skills：

```bash
node apps/electron/scripts/test-bundled-skills.cjs
```

测试内容：
- ✅ 验证 bundled skills 目录存在
- ✅ 检查每个 skill 的 SKILL.md 文件
- ✅ 测试复制功能到临时 workspace
- ✅ 检查 Windows 兼容性问题

### 6. 添加新的 Bundled Skill

1. 将 skill 目录放到 `apps/electron/resources/bundled-skills/`
2. 确保包含 `SKILL.md` 文件
3. 可选：添加 `icon.svg` 文件
4. 运行测试：`node apps/electron/scripts/test-bundled-skills.cjs`
5. 重新构建应用：`bun run electron:build`

### 7. 更新 Bundled Skill

**对于新 workspace：**
- 直接更新 `resources/bundled-skills/` 中的文件
- 重新构建应用
- 新创建的 workspace 会获得更新后的版本

**对于现有 workspace：**
- **没有 skills 的 workspace**：下次启动应用时会自动安装 bundled skills
- **已有 skills 的 workspace**：不会自动更新（保护用户修改）
- 如需更新，用户需要手动删除 `{workspace}/skills/{skill-slug}/` 并重启应用

**判断逻辑：**
- 使用标记文件 `.bundled-skills-installed` 追踪安装状态
- 如果标记文件存在 → 已安装，跳过
- 如果标记文件不存在 → 未安装，执行安装
- 标记文件内容：JSON 格式，包含安装时间、版本、数量

**优点：**
- 准确追踪安装状态
- 用户删除 skills 后不会被重新安装
- 性能好（只需检查文件是否存在）
- 可以追踪版本信息

### 8. 日志

所有操作都会记录到日志中，前缀为 `[BundledSkills]`：

```
[BundledSkills] Initializing bundled skills for existing workspace: My Workspace
[BundledSkills] Found 13 bundled skills, installing to workspace...
[BundledSkills] Installed skill: agent-browser
[BundledSkills] Skill 'claude-mem' already exists, skipping
[BundledSkills] Installation complete: 10 installed, 3 skipped
[BundledSkills] Initialized bundled skills for 2 existing workspace(s)
```

### 9. 故障排查

#### Skills 没有被安装

1. 检查日志中的 `[BundledSkills]` 消息
2. 验证 bundled skills 目录在打包后的应用中存在
3. 检查 workspace skills 目录权限
4. 尝试创建新 workspace 测试安装

#### 现有 workspace 没有获得 bundled skills

1. 检查 workspace 的 skills 目录是否已有 3 个或更多 skills
2. 如果有，说明系统认为 workspace 已有 skills，不会自动安装
3. 如果需要安装，手动删除一些 skills 使总数少于 3 个，然后重启应用
4. 或者手动从 `resources/bundled-skills/` 复制需要的 skills

#### Windows 解压失败

1. 确保没有 `.DS_Store` 文件
2. 确保没有 `__pycache__` 目录
3. 使用 `zip -r -X` 创建 zip 文件（排除扩展属性）

## 测试结果

```
🧪 Testing Bundled Skills Functionality

✅ Bundled skills directory found
✅ Found 13 bundled skills
✅ All skills have valid SKILL.md files
✅ Test installation successful
✅ No Windows compatibility issues found

📦 Ready to bundle 13 skills into the app
```

## 下一步

1. 构建应用：`bun run electron:build`
2. 安装并启动应用
3. 创建 workspace 或使用默认 workspace
4. 检查 `{workspace}/skills/` 目录确认 skills 已安装
5. 在应用中验证 skills 可以正常使用
