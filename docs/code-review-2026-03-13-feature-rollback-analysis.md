# Code Review: Feature Rollback Analysis

**Date:** 2026-03-13
**Branch:** cvte/main (feat/browser-tools)
**Reviewer:** Claude Sonnet 4.6
**Requested by:** User

## Executive Summary

对近期主分支（cvte/main）的提交进行了全面review，检查了4个可能被回滚的功能。**结论：所有功能均正常，未发现回滚问题。**

---

## 检查的功能点

### ✅ 功能1：会话标题语言跟随

**状态：** ✅ 正常，未被回滚

**描述：** 会话标题生成根据app语言设置生成，而不是固定英文。

**实现位置：**
- `packages/shared/src/utils/title-generator.ts`
  - `buildTitlePrompt(message, language?)` - 第16行
  - `buildRegenerateTitlePrompt(messages, response, language?)` - 第40行
  - 当language参数存在且不是'en'时，添加语言指令到prompt中

- `apps/electron/src/main/sessions.ts`
  - 第4157行：`agent.regenerateTitle(userMessages, assistantResponse, loadStoredConfig()?.language)`
  - 第5305行：`agent.generateTitle(userMessage, loadStoredConfig()?.language)`

**添加时间：** 2026-02-19 (commit cb0d8a6)

**来源：** 从upstream PR #220 cherry-pick

**验证方法：**
```bash
# 检查title-generator.ts是否有language参数
grep -n "language" packages/shared/src/utils/title-generator.ts

# 检查sessions.ts是否传递language参数
grep -n "loadStoredConfig()?.language" apps/electron/src/main/sessions.ts
```

---

### ✅ 功能2：文件链接点击打开

**状态：** ✅ 正常，支持多格式文件打开

**描述：** 在会话中点击生成的文件链接可以快速打开，支持多种格式（包括excel等Office文件）。

**实现架构：**
```
用户点击文件链接
  ↓
Markdown组件 onFileClick
  ↓
useLinkInterceptor.handleOpenFile
  ↓
classifyFile(path)
  ├─ 可预览 (image/pdf/code/markdown/json/text)
  │   └─ 显示in-app preview overlay
  └─ 不可预览 (excel/word/ppt/zip/video/audio)
      └─ shell.openPath 打开外部应用
```

**关键文件：**

1. **文件路径检测**
   - `packages/ui/src/components/markdown/linkify.ts`
   - 使用linkify-it + 自定义regex检测文件路径
   - 支持 `/path`, `~/path`, `./path`, `file://` 格式

2. **链接点击处理**
   - `packages/ui/src/components/markdown/Markdown.tsx:131-145`
   - `<a>` 标签的onClick handler
   - 检查FILE_PATH_REGEX和file://协议

3. **文件分类和路由**
   - `apps/electron/src/renderer/hooks/useLinkInterceptor.ts:140`
   - `handleOpenFile` 函数根据文件类型决定预览或外部打开

4. **文件类型定义**
   - `packages/ui/src/lib/file-classification.ts`
   - 第77行：`EXTERNAL_EXTENSIONS` 包含 xlsx, xls, xlsm, docx, pptx等
   - 这些文件会通过shell.openPath打开

5. **IPC实现**
   - `apps/electron/src/preload/index.ts:130` - 暴露openFile API
   - `apps/electron/src/main/ipc.ts:1501` - IPC handler
   - 使用`shell.openPath(safePath)`打开文件

**支持的文件格式：**
- **预览：** image (png/jpg/gif/webp/svg), pdf, code (ts/js/py/go等), markdown, json, text
- **外部打开：** Office (xlsx/docx/pptx), 压缩包 (zip/tar/gz), 视频 (mp4/mov), 音频 (mp3/wav), 可执行文件

**验证方法：**
```bash
# 检查file classification
cat packages/ui/src/lib/file-classification.ts | grep -A 10 "EXTERNAL_EXTENSIONS"

# 检查IPC handler
grep -A 10 "IPC_CHANNELS.OPEN_FILE" apps/electron/src/main/ipc.ts
```

---

### ✅ 功能3：文件生成位置

**状态：** ✅ 正常，默认行为符合预期

**描述：** Agent生成的文件在session目录（`~/.workagent/workspaces/{id}/sessions/{sessionId}/`）而不是workspace工作文件夹。

**行为说明：**

| 场景 | workingDirectory | isolateSessionDirectory | 文件生成位置 |
|------|------------------|------------------------|-------------|
| 默认（未配置） | undefined | true (默认) | `~/.workagent/workspaces/{id}/sessions/{sessionId}/` |
| 配置了工作目录 | `/path/to/project` | true (默认) | `/path/to/project/{sessionId}/` |
| 配置了工作目录 | `/path/to/project` | false | `/path/to/project/` |

**关键实现：**

1. **默认使用session path**
   - `packages/shared/src/sessions/storage.ts:203`
   ```typescript
   const sdkCwd = options?.workingDirectory ?? getSessionPath(workspaceRootPath, sessionId);
   ```

2. **isolateSessionDirectory逻辑**
   - `apps/electron/src/main/sessions.ts:2341-2349`
   ```typescript
   const isolateSessionDir = wsConfig?.defaults?.isolateSessionDirectory ?? true
   if (isolateSessionDir && resolvedWorkingDir) {
     const isolatedDir = join(resolvedWorkingDir, storedSession.id)
     await mkdir(isolatedDir, { recursive: true })
     await updateSessionMetadata(workspaceRootPath, storedSession.id, {
       workingDirectory: isolatedDir,
     })
     resolvedWorkingDir = isolatedDir
   }
   ```

3. **默认值修复**
   - Commit ec4af1d (2026-02-21)
   - 将默认值从false改为true
   - 修复了UI显示enabled但实际不工作的问题

**配置位置：**
- UI: Workspace Settings → Advanced → "Isolate session directory"
- Config: `~/.workagent/workspaces/{id}/config.json`
  ```json
  {
    "defaults": {
      "isolateSessionDirectory": true
    }
  }
  ```

**验证方法：**
```bash
# 检查默认值
grep -n "isolateSessionDirectory ?? true" apps/electron/src/main/sessions.ts

# 检查session storage默认行为
grep -A 5 "const sdkCwd" packages/shared/src/sessions/storage.ts
```

---

### ✅ 功能4：其他设置检查

**状态：** ✅ 未发现回滚

**检查的合并操作：**

1. **074387a (2026-03-01) - Merge feat/windows-bundled-tools**
   - 目的：为Windows打包MinGit和Python
   - 影响文件：19个文件，主要是新增
   - 修改的现有文件：
     - `apps/electron/src/main/sessions.ts` - 添加bundled tools环境变量
     - `apps/electron/src/main/tool-detection.ts` - 添加bundled tools检测
     - `apps/electron/src/shared/types.ts` - 添加类型定义
   - **结论：** 只添加新功能，未修改或删除现有功能

2. **a722c05 (2026-02-21) - Merge fix/review-issues**
   - 目的：修复v0.4.8的code review issues
   - 修复内容：
     - Security: 恢复validateFilePath allowlist
     - Bugs: 清理stale remoteUrl, AskUserQuestion timeout
     - **isolateSessionDirectory默认值修复**
     - i18n: SessionMenu和PermissionDialog字符串
   - **结论：** 修复问题，未引入回滚

3. **d0fc5de (2026-02-20) - Merge feat/session-isolated-dir**
   - 目的：添加session isolated directory功能
   - 新增功能，非回滚

**验证方法：**
```bash
# 查看合并提交的文件变更
git show 074387a --stat
git show a722c05 --stat

# 检查sessions.ts的改动
git diff 5982125 074387a -- apps/electron/src/main/sessions.ts
```

---

## 分支对比

### cvte/main vs feat/browser-tools

**title-generator.ts差异：**
- feat/browser-tools分支**有**language参数支持
- cvte/main分支**也有**language参数支持
- 两个分支都正常

**结论：** feat/browser-tools是从cvte/main分出来的，包含了所有cvte/main的功能。

---

## 可能的问题原因

如果用户在实际使用中发现这些功能不工作，可能的原因：

1. **版本问题**
   - 使用的是旧版本的构建
   - 解决方法：重新构建 `bun run electron:build`

2. **配置缓存**
   - 配置文件缓存了旧的设置
   - 解决方法：检查 `~/.workagent/config.json`

3. **特定场景**
   - 某些edge case未覆盖
   - 需要提供具体的复现步骤和日志

4. **开发模式 vs 生产构建**
   - 开发模式（`bun run electron:dev`）和生产构建可能有差异
   - 确认在哪个环境下测试

---

## 建议

1. **确认版本**
   ```bash
   # 查看当前分支
   git branch --show-current

   # 查看最新提交
   git log --oneline -1
   ```

2. **重新构建**
   ```bash
   # 清理构建产物
   bun run electron:clean

   # 重新构建
   bun run electron:build
   ```

3. **检查配置**
   ```bash
   # 查看workspace配置
   cat ~/.workagent/config.json | jq '.workspaces'

   # 查看特定workspace的配置
   cat ~/.workagent/workspaces/{workspace-name}/config.json
   ```

4. **测试验证**
   - 功能1：创建新会话，发送中文消息，检查生成的标题是否是中文
   - 功能2：让agent生成一个excel文件，点击文件路径链接，检查是否能打开
   - 功能3：检查生成的文件位置是否在session目录下

---

## 相关Commits

| Commit | Date | Description |
|--------|------|-------------|
| cb0d8a6 | 2026-02-19 | fix: i18n runtime issues after cherry-pick from upstream PR #220 |
| ec4af1d | 2026-02-21 | fix: align isolateSessionDirectory default to true across all layers |
| d0fc5de | 2026-02-20 | Merge feat/session-isolated-dir |
| a722c05 | 2026-02-21 | Merge fix/review-issues |
| 074387a | 2026-03-01 | Merge feat/windows-bundled-tools |

---

## 结论

**所有4个功能在cvte/main分支上都是正常的，没有被回滚。**

如果问题仍然存在，建议：
1. 提供具体的复现步骤
2. 提供相关的日志输出
3. 说明是在开发模式还是生产构建中遇到的问题
4. 提供当前的git commit hash

---

**Review完成时间：** 2026-03-13
**Review工具：** Git log, grep, diff analysis
**检查范围：** 2026-02-15 至 2026-03-13 的所有合并提交
