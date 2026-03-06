# Bundled Skills 设计 Review

## 设计问题分析

### 问题 1：判断逻辑不够准确 ❌

**原始设计：**
```typescript
// 如果 skills < 3 个，就自动安装
return skillDirs.length < 3;
```

**问题：**
- 用户可能故意只想要 1-2 个 skills
- 用户删除 bundled skills 后，每次启动都会被重新安装
- 硬编码的阈值（3）不够灵活
- 无法区分"从未安装"和"用户删除了部分 skills"

**改进方案：** ✅
使用标记文件 `.bundled-skills-installed` 追踪安装状态：
```typescript
function hasBundledSkillsMarker(workspaceRoot: string): boolean {
  const markerPath = join(workspaceRoot, 'skills', '.bundled-skills-installed');
  return existsSync(markerPath);
}
```

### 问题 2：缺少安装标记 ❌

**原始设计：** 没有标记文件追踪安装状态

**问题：**
- 无法区分"从未安装"和"用户删除了部分 skills"
- 无法追踪 bundled skills 的版本
- 无法防止重复安装

**改进方案：** ✅
创建标记文件记录安装信息：
```typescript
function createBundledSkillsMarker(workspaceRoot: string, installedCount: number): void {
  const markerContent = JSON.stringify({
    installedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    installedCount,
  }, null, 2);
  writeFileSync(markerPath, markerContent, 'utf-8');
}
```

### 问题 3：性能问题 ⚠️

**原始设计：** 每次启动都检查所有 workspace

**问题：**
- 如果有很多 workspace，启动可能变慢
- 文件复制是同步操作，可能阻塞启动

**改进方案：** ✅
使用标记文件后，检查变得非常快（只需检查文件是否存在）：
```typescript
export function shouldInitializeBundledSkills(workspaceRoot: string): boolean {
  // 快速检查：标记文件存在 = 已安装
  if (hasBundledSkillsMarker(workspaceRoot)) {
    return false;
  }
  return true;
}
```

**进一步优化建议：**
- 可以考虑异步初始化（不阻塞启动）
- 可以在后台线程中执行文件复制

### 问题 4：用户体验 ⚠️

**问题：**
- 用户不知道这些 skills 是从哪来的
- 没有办法选择不安装 bundled skills
- 用户删除后可能被重新安装（原始设计）

**改进方案：** ✅
- 使用标记文件后，用户删除 skills 不会被重新安装
- 标记文件包含安装信息（时间、版本、数量）

**进一步改进建议：**
- 在 UI 中显示哪些 skills 是 bundled 的
- 提供"重新安装 bundled skills"的选项
- 在首次启动时显示欢迎提示，告知用户已安装 bundled skills

## 改进后的设计

### 核心机制

1. **标记文件** `.bundled-skills-installed`
   - 位置：`{workspace}/skills/.bundled-skills-installed`
   - 内容：JSON 格式，包含安装时间、版本、数量
   - 作用：防止重复安装，追踪安装状态

2. **判断逻辑**
   ```typescript
   if (hasBundledSkillsMarker(workspaceRoot)) {
     return false; // 已安装，跳过
   }
   return true; // 未安装，需要安装
   ```

3. **安装流程**
   ```
   检查标记文件
     ↓
   不存在 → 安装 bundled skills
     ↓
   创建标记文件
     ↓
   完成
   ```

### 用户场景

**场景 1：新用户首次启动**
- 创建默认 workspace
- 没有标记文件 → 安装 bundled skills
- 创建标记文件
- ✅ 完成

**场景 2：用户升级应用（旧 workspace）**
- 启动时检查 workspace
- 没有标记文件 → 安装 bundled skills
- 创建标记文件
- ✅ 用户获得 bundled skills

**场景 3：用户删除某个 skill**
- 标记文件仍然存在
- 下次启动不会重新安装
- ✅ 尊重用户选择

**场景 4：用户想重新安装 bundled skills**
- 删除标记文件 `.bundled-skills-installed`
- 重启应用
- ✅ 重新安装

## 剩余问题和建议

### 1. 版本更新问题

**问题：** 如果 bundled skills 更新了，现有 workspace 无法获得更新

**建议方案：**
- 在标记文件中记录 bundled skills 的版本号
- 启动时比较版本，如果有新版本，提示用户更新
- 提供"更新 bundled skills"的 UI 选项

### 2. 性能优化

**建议方案：**
- 将 bundled skills 初始化改为异步操作
- 在后台线程中执行文件复制
- 显示进度提示（如果文件很多）

### 3. 用户体验

**建议方案：**
- 在 skills 列表中标记哪些是 bundled skills
- 提供"重新安装 bundled skills"的菜单选项
- 首次启动时显示欢迎提示

### 4. 错误处理

**建议方案：**
- 如果安装失败，不创建标记文件
- 记录详细的错误日志
- 提供重试机制

## 总结

改进后的设计解决了主要问题：

✅ **使用标记文件** - 准确追踪安装状态
✅ **防止重复安装** - 尊重用户选择
✅ **性能优化** - 快速检查标记文件
✅ **版本追踪** - 记录安装信息

剩余的改进空间：
- 版本更新机制
- 异步初始化
- UI 提示和选项
- 错误处理和重试
