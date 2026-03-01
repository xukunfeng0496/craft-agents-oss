# Windows Bundled Tools Design

**Date**: 2026-03-01
**Status**: Design Phase
**Author**: Claude Code + User

## Overview

为Windows用户提供开箱即用的开发工具体验，通过将Git和Python打包进应用，消除手动安装的复杂性。

## Background

### Current Problem
- Windows用户默认没有安装Python或Git Bash
- 现有设计在初始化时检查并引导用户安装
- 对普通用户来说安装过程仍然困难
- 增加了用户上手的门槛

### Goals
1. Windows用户无需手动安装任何工具即可使用应用
2. 确保所有Windows用户获得一致的工具版本和行为
3. 保持应用体积在合理范围内
4. 不破坏现有用户的使用体验

## Design

### 1. Overall Architecture

**Tool Selection**:
- **MinGit** (~45MB): Git for Windows精简版
  - 包含完整的Git和bash 4.4+
  - 包含常用Unix工具（grep, sed, awk, find, tar等）
  - 与Git Bash完全兼容
- **Embedded Python 3.12** (~15MB): 官方便携版
  - 包含标准库和pip支持
  - 无需安装，直接可用

**Storage Location**:
- 打包到应用资源目录：`resources/tools/mingit/` 和 `resources/tools/python/`
- 使用`app.asar.unpacked`确保工具可执行（Electron打包时不压缩）

**Detection Priority** (Windows only):
1. 内置工具（bundled）- 默认优先
2. 系统PATH中的工具（system）- fallback
3. 都不可用 - 显示错误

**Key Benefits**:
- 零配置：Windows用户无需手动安装任何工具
- 一致性：所有用户使用相同版本，避免兼容性问题
- 体积合理：总增加~60MB，对现代应用可接受
- 维护简单：工具随应用版本更新

### 2. Implementation Components

**Package Structure**:
```
apps/electron/
├── resources/
│   └── tools/
│       ├── mingit/          # MinGit portable (~45MB)
│       │   ├── cmd/
│       │   │   ├── git.exe
│       │   │   └── bash.exe
│       │   └── usr/bin/     # Unix tools (grep, sed, awk, etc.)
│       └── python/          # Embedded Python (~15MB)
│           ├── python.exe
│           ├── python312.dll
│           └── Lib/         # Standard library
```

**New/Modified Files**:

1. **`packages/shared/src/tools/bundled-tools.ts`** (new)
   - Detect and return bundled tool paths
   - Exports: `getBundledGitPath()`, `getBundledPythonPath()`

2. **`apps/electron/src/main/tool-detection.ts`** (modify)
   - Enhanced detection logic: bundled first, then system fallback
   - Return tool path and source (bundled/system)

3. **`electron-builder.yml`** (modify)
   - Configure `asarUnpack` to keep tools directory uncompressed
   - Add tool files to package manifest

**Key API Design**:
```typescript
interface ToolInfo {
  found: boolean
  path?: string        // Executable file path
  source: 'system' | 'bundled' | 'none'
  version?: string     // Tool version
}
```

### 3. Tool Detection Logic

**Detection Flow** (prioritize bundled tools):

```typescript
async function detectToolPath(toolName: 'git' | 'python'): Promise<ToolInfo> {
  // 1. Prioritize bundled tools (Windows platform)
  if (process.platform === 'win32') {
    const bundledPath = getBundledToolPath(toolName)
    if (await fileExists(bundledPath)) {
      return {
        found: true,
        path: bundledPath,
        source: 'bundled',
        version: await getToolVersion(bundledPath)
      }
    }
  }

  // 2. Fallback to system tools (or non-Windows platforms)
  const systemTool = await checkSystemTool(toolName)
  if (systemTool.found) {
    return { ...systemTool, source: 'system' }
  }

  // 3. Not available
  return { found: false, source: 'none' }
}
```

**Environment Variable Handling**:
- When starting agent, dynamically build `PATH` environment variable
- If using bundled tools, prepend `resources/tools/mingit/cmd` and `resources/tools/python` to PATH
- Ensure agent subprocess inherits correct PATH

**Integration with Existing Code**:
1. Modify agent startup logic in `apps/electron/src/main/sessions.ts`
2. Call tool detection before creating agent process
3. Inject detected tool paths into agent environment variables
4. Keep existing `tool-detection.ts` as detection foundation, enhance its functionality

**User Experience**:
- Windows users on first launch: directly use bundled tools, no configuration needed
- Users with Git/Python installed: automatically use bundled tools for consistency
- Settings page shows current tool source (bundled/system)

### 4. Error Handling

**Error Scenarios**:

1. **Bundled Tools Corrupted or Missing**
   - Detection: Verify tool file integrity on startup
   - Handling: Show error dialog, prompt to reinstall app
   - Fallback: Try using system tools (if available)

2. **Tool Version Incompatibility**
   - Scenario: Some agent operations require specific Git/Python features
   - Handling: Declare tool versions in agent system prompt
   - Logging: Record tool version info for troubleshooting

3. **PATH Environment Variable Conflicts**
   - Scenario: User system PATH has other Git/Python versions
   - Handling: Ensure bundled tool paths are at the front of PATH
   - Verification: After agent starts, execute `which git` and `which python` to confirm paths

4. **Permission Issues**
   - Windows: Ensure tool directory has execute permissions
   - During packaging: Use `chmod +x` to mark executable files
   - Runtime: Detect and fix permission issues

**Degradation Strategy**:
```typescript
// Tool availability levels
enum ToolAvailability {
  BUNDLED_OK = 'bundled_ok',      // Bundled tools available (best)
  SYSTEM_OK = 'system_ok',         // System tools available (acceptable)
  NONE = 'none'                    // No tools available (error)
}
```

**User Notifications**:
- Bundled tools working: No prompt (silent operation)
- Using system tools: Show warning icon in settings page
- No tools available: Show error dialog on startup, prevent session creation

### 5. Packaging and Distribution

**Tool Preparation** (before build):

1. **Download and Prepare MinGit**
   - Download from official: `https://github.com/git-for-windows/git/releases`
   - Version: MinGit-2.44.0-64-bit.zip (~45MB)
   - Extract to: `apps/electron/resources/tools/mingit/`

2. **Download and Prepare Embedded Python**
   - Download from official: `https://www.python.org/downloads/windows/`
   - Version: python-3.12.x-embed-amd64.zip (~15MB)
   - Extract to: `apps/electron/resources/tools/python/`
   - Configure pip: Unpack `python312._pth`, add `import site` to enable pip

**Electron Builder Configuration** (`electron-builder.yml`):

```yaml
files:
  - "!**/*"
  - "dist/**/*"
  - "resources/**/*"  # Include tools directory

asarUnpack:
  - "resources/tools/**/*"  # Don't compress tools, keep executable

win:
  target:
    - nsis
  extraResources:
    - from: "resources/tools"
      to: "tools"
      filter: ["**/*"]
```

**Build Script Enhancement** (`package.json`):

```json
{
  "scripts": {
    "tools:download": "node scripts/download-tools.js",
    "prebuild": "bun run tools:download",
    "electron:dist:win": "bun run prebuild && electron-builder --win"
  }
}
```

**Automated Download Script** (`scripts/download-tools.js`):
- Check if tools directory already exists
- If not, automatically download MinGit and Python
- Verify file integrity (SHA256 checksum)
- Extract and configure tools

**Version Management**:
- Record tool versions in `package.json`
- Regularly update tool versions (follow app version releases)

### 6. Quality Assurance and Testing

**Automated Testing Layers**:

1. **Unit Tests** (`packages/shared/src/tools/__tests__/`)
   ```typescript
   describe('bundled-tools', () => {
     it('should detect bundled git on Windows', () => {
       // Mock process.platform = 'win32'
       // Mock file system
       // Verify returns correct bundled path
     })

     it('should fallback to system tools when bundled missing', () => {
       // Verify degradation logic
     })
   })
   ```

2. **Integration Tests** (`apps/electron/src/main/__tests__/`)
   ```typescript
   describe('tool-detection integration', () => {
     it('should start agent with bundled tools on Windows', async () => {
       // Mock Windows environment
       // Start agent
       // Verify PATH includes bundled tool paths
     })
   })
   ```

3. **E2E Tests** (using Playwright)
   ```typescript
   test('Windows: create session with bundled tools', async () => {
     // Run in Windows VM
     // Create new session
     // Execute git and python commands
     // Verify commands execute successfully
     })
   ```

**CI/CD Integration** (GitHub Actions):

```yaml
# .github/workflows/test-windows-bundled-tools.yml
name: Test Windows Bundled Tools

on: [push, pull_request]

jobs:
  test-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Download bundled tools
        run: bun run tools:download

      - name: Verify tools exist
        run: |
          test -f apps/electron/resources/tools/mingit/cmd/git.exe
          test -f apps/electron/resources/tools/python/python.exe

      - name: Run unit tests
        run: bun test

      - name: Build Windows package
        run: bun run electron:dist:win

      - name: Test packaged app
        run: |
          # Install packaged app
          # Start app
          # Verify tool availability
```

**Package Verification Script** (`scripts/verify-bundled-tools.js`):
```javascript
// Run automatically after packaging
// Verify:
// 1. tools directory exists in unpacked resources
// 2. All required executable files exist
// 3. File permissions are correct
// 4. File sizes match expectations (prevent corruption)
```

**Cross-Platform Development Strategy**:
- Primary development on macOS
- Automated Windows testing via CI/CD
- Manual Windows testing before major releases
- Community beta testing on Windows

## Implementation Roadmap

### Phase 1: Tool Preparation and Download Script (1-2 days)
- Create `scripts/download-tools.js` automated download script
- Download MinGit and Embedded Python to `resources/tools/`
- Verify tool integrity and executability
- Update `.gitignore` to exclude tools directory (large size)

### Phase 2: Core Detection Logic (2-3 days)
- Create `packages/shared/src/tools/bundled-tools.ts`
- Modify `apps/electron/src/main/tool-detection.ts`
- Implement priority detection logic (bundled > system)
- Add unit tests

### Phase 3: Agent Integration (2-3 days)
- Modify `apps/electron/src/main/sessions.ts`
- Inject correct PATH environment variables on agent startup
- Test agent can correctly call bundled tools
- Add integration tests

### Phase 4: Packaging Configuration (1-2 days)
- Modify `electron-builder.yml` configuration
- Configure `asarUnpack` to ensure tools aren't compressed
- Update build scripts
- Test packaging process locally

### Phase 5: CI/CD and Automated Testing (2-3 days)
- Create GitHub Actions workflow
- Add Windows platform automated testing
- Create package verification script
- End-to-end testing

### Phase 6: UI and User Experience (1-2 days)
- Show tool source in settings page
- Add "Use System Tools" advanced option (optional)
- Update onboarding flow (remove tool installation guidance)

## Key Considerations

1. **Size Control**: Don't commit tools directory to git, only download during build
2. **Version Locking**: Explicitly specify MinGit and Python version numbers in config
3. **Permission Handling**: Ensure .exe files have execute permissions on Windows
4. **Path Handling**: Use `app.getPath('exe')` to dynamically get resource paths
5. **Backward Compatibility**: Keep support for system tools, don't break existing user experience

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Package size increases by 60MB | Only bundle tools in Windows version |
| Tool download failure causes build failure | Provide local cache mechanism, support offline builds |
| Cross-platform development hard to test | Comprehensive CI/CD and automated testing |
| Bundled tools become outdated | Regular updates following app version releases |
| Tool conflicts with system installations | Bundled tools take priority via PATH ordering |

## Success Criteria

1. ✅ Windows users can create sessions without installing Git/Python
2. ✅ All Windows users use the same tool versions
3. ✅ Package size increase stays under 70MB
4. ✅ CI/CD automatically tests Windows builds
5. ✅ No regression in existing functionality
6. ✅ Settings page clearly shows tool source

## Future Enhancements

1. **Auto-update mechanism**: Update bundled tools independently of app updates
2. **Tool selection UI**: Let users choose between bundled and system tools
3. **Additional tools**: Bundle other useful tools (make, curl, etc.)
4. **Linux support**: Consider bundling tools for Linux distributions without them
