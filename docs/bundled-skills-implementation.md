# Bundled Skills Implementation

## 概述

这个实现将预装的 skills 打包到应用中，在首次启动时自动安装到用户的全局 skills 目录 (`~/.agents/skills/`)，无需手动安装。

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

负责在首次启动时将 bundled skills 复制到 `~/.agents/skills/`：

- `initializeBundledSkills()` - 主初始化函数
- `reinstallBundledSkills()` - 强制重新安装（用于调试）
- 使用 `.bundled-skills-installed` 标记文件避免重复安装
- 跳过已存在的 skills（保护用户修改）

#### `apps/electron/src/main/index.ts`

在 `app.whenReady()` 中调用初始化：

```typescript
import { initializeBundledSkills } from './bundled-skills'

app.whenReady().then(async () => {
  // ... 其他初始化代码 ...

  // Initialize bundled skills to ~/.agents/skills/
  initializeBundledSkills()

  // ... 其他初始化代码 ...
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
│ 2. First Launch                                              │
│    initializeBundledSkills() 检查标记文件                    │
│    └─ 不存在 → 复制所有 skills 到 ~/.agents/skills/        │
│    └─ 已存在 → 跳过（避免覆盖用户修改）                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Subsequent Launches                                       │
│    检测到 .bundled-skills-installed 标记文件                 │
│    └─ 跳过初始化                                            │
└─────────────────────────────────────────────────────────────┘
```

### 4. 跨平台兼容性

#### macOS
- Bundled skills 路径: `app.asar/resources/bundled-skills/`
- 安装目标: `~/.agents/skills/`

#### Windows
- Bundled skills 路径: `resources/app/resources/bundled-skills/`
- 安装目标: `~/.agents/skills/`
- 注意事项：
  - 已清理 `.DS_Store` 文件
  - 已清理 `__pycache__` 目录
  - 使用 `-X` 参数创建 zip 避免扩展属性问题

#### Linux
- Bundled skills 路径: `resources/app/resources/bundled-skills/`
- 安装目标: `~/.agents/skills/`

### 5. 测试

运行测试脚本验证 bundled skills：

```bash
node apps/electron/scripts/test-bundled-skills.cjs
```

测试内容：
- ✅ 验证 bundled skills 目录存在
- ✅ 检查每个 skill 的 SKILL.md 文件
- ✅ 测试复制功能
- ✅ 检查 Windows 兼容性问题

### 6. 添加新的 Bundled Skill

1. 将 skill 目录放到 `apps/electron/resources/bundled-skills/`
2. 确保包含 `SKILL.md` 文件
3. 可选：添加 `icon.svg` 文件
4. 运行测试：`node apps/electron/scripts/test-bundled-skills.cjs`
5. 重新构建应用：`bun run electron:build`

### 7. 更新 Bundled Skill

**对于新用户：**
- 直接更新 `resources/bundled-skills/` 中的文件
- 重新构建应用
- 新用户首次启动时会获得更新后的版本

**对于现有用户：**
- 现有用户不会自动更新（保护用户修改）
- 如需强制更新，用户需要：
  1. 删除 `~/.agents/skills/{skill-slug}/`
  2. 删除 `~/.agents/skills/.bundled-skills-installed`
  3. 重启应用

### 8. 日志

所有操作都会记录到日志中，前缀为 `[BundledSkills]`：

```
[BundledSkills] Found 13 bundled skills, installing...
[BundledSkills] Installed skill: agent-browser
[BundledSkills] Skill 'claude-mem' already exists, skipping
[BundledSkills] Installation complete: 10 installed, 3 skipped
```

### 9. 故障排查

#### Skills 没有被安装

1. 检查日志中的 `[BundledSkills]` 消息
2. 验证 bundled skills 目录在打包后的应用中存在
3. 检查 `~/.agents/skills/` 目录权限
4. 删除 `.bundled-skills-installed` 标记文件并重启

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
3. 检查 `~/.agents/skills/` 目录确认 skills 已安装
4. 在应用中验证 skills 可以正常使用
