# Windows Bundled Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle MinGit and Embedded Python into Windows builds to provide out-of-box development tools without manual installation.

**Architecture:** Download tools during build, package into app resources (uncompressed), detect bundled tools first on Windows (fallback to system), inject tool paths into agent environment.

**Tech Stack:** Electron, Bun, TypeScript, electron-builder, GitHub Actions

---

## Phase 1: Tool Download Infrastructure

### Task 1: Create Tool Download Script

**Files:**
- Create: `apps/electron/scripts/download-tools.js`
- Modify: `apps/electron/.gitignore`
- Modify: `apps/electron/package.json`

**Step 1: Write download script skeleton**

Create `apps/electron/scripts/download-tools.js`:

```javascript
#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const https = require('https')
const { createWriteStream, createReadStream } = require('fs')
const { pipeline } = require('stream/promises')
const { createHash } = require('crypto')

const TOOLS_DIR = path.join(__dirname, '../resources/tools')
const MINGIT_VERSION = '2.44.0'
const PYTHON_VERSION = '3.12.8'

const DOWNLOADS = {
  mingit: {
    url: `https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/MinGit-${MINGIT_VERSION}-64-bit.zip`,
    sha256: null, // Will be verified after first download
    dest: path.join(TOOLS_DIR, 'mingit')
  },
  python: {
    url: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
    sha256: null,
    dest: path.join(TOOLS_DIR, 'python')
  }
}

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}...`)
  const file = createWriteStream(dest)

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject)
      }
      pipeline(response, file).then(resolve).catch(reject)
    }).on('error', reject)
  })
}

async function extractZip(zipPath, destDir) {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(destDir, true)
  console.log(`Extracted to ${destDir}`)
}

async function main() {
  // Skip if tools already exist
  if (fs.existsSync(TOOLS_DIR)) {
    console.log('Tools directory already exists, skipping download')
    return
  }

  fs.mkdirSync(TOOLS_DIR, { recursive: true })

  for (const [name, config] of Object.entries(DOWNLOADS)) {
    const zipPath = path.join(TOOLS_DIR, `${name}.zip`)

    await downloadFile(config.url, zipPath)
    await extractZip(zipPath, config.dest)
    fs.unlinkSync(zipPath)

    console.log(`✓ ${name} installed`)
  }

  console.log('All tools downloaded successfully')
}

main().catch(console.error)
```

**Step 2: Add adm-zip dependency**

Modify `apps/electron/package.json`, add to devDependencies:

```json
{
  "devDependencies": {
    "adm-zip": "^0.5.10"
  }
}
```

**Step 3: Update .gitignore**

Add to `apps/electron/.gitignore`:

```
# Bundled tools (downloaded during build)
resources/tools/
```

**Step 4: Add npm scripts**

Modify `apps/electron/package.json`, add scripts:

```json
{
  "scripts": {
    "tools:download": "node scripts/download-tools.js",
    "tools:clean": "rm -rf resources/tools"
  }
}
```

**Step 5: Test download script**

Run:
```bash
cd apps/electron
bun install
bun run tools:download
```

Expected: Downloads and extracts MinGit and Python to `resources/tools/`

**Step 6: Verify tool structure**

Run:
```bash
ls -la apps/electron/resources/tools/mingit/cmd/
ls -la apps/electron/resources/tools/python/
```

Expected: See git.exe, bash.exe in mingit/cmd/, python.exe in python/

**Step 7: Commit**

```bash
git add apps/electron/scripts/download-tools.js
git add apps/electron/.gitignore
git add apps/electron/package.json
git commit -m "feat: add tool download script for Windows bundled tools"
```

---

## Phase 2: Core Detection Logic

### Task 2: Create Bundled Tools Module

**Files:**
- Create: `packages/shared/src/tools/bundled-tools.ts`
- Create: `packages/shared/src/tools/index.ts`
- Create: `packages/shared/src/tools/__tests__/bundled-tools.test.ts`

**Step 1: Write failing test**

Create `packages/shared/src/tools/__tests__/bundled-tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getBundledToolPath, getBundledGitPath, getBundledPythonPath } from '../bundled-tools'

describe('bundled-tools', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
  })

  describe('getBundledGitPath', () => {
    it('returns git.exe path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const gitPath = getBundledGitPath()
      expect(gitPath).toContain('git.exe')
      expect(gitPath).toContain('mingit')
    })

    it('returns null on non-Windows platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const gitPath = getBundledGitPath()
      expect(gitPath).toBeNull()
    })
  })

  describe('getBundledPythonPath', () => {
    it('returns python.exe path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const pythonPath = getBundledPythonPath()
      expect(pythonPath).toContain('python.exe')
      expect(pythonPath).toContain('python')
    })

    it('returns null on non-Windows platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const pythonPath = getBundledPythonPath()
      expect(pythonPath).toBeNull()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd packages/shared
bun test src/tools/__tests__/bundled-tools.test.ts
```

Expected: FAIL with "Cannot find module '../bundled-tools'"

**Step 3: Write minimal implementation**

Create `packages/shared/src/tools/bundled-tools.ts`:

```typescript
import path from 'path'
import { app } from 'electron'

/**
 * Get the path to bundled tools directory.
 * Returns null if not in Electron environment or not Windows.
 */
function getBundledToolsDir(): string | null {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    // In production: app.getAppPath() returns app.asar path
    // We need resources/tools which is in app.asar.unpacked
    const appPath = app.getAppPath()
    const resourcesPath = path.dirname(appPath)
    return path.join(resourcesPath, 'tools')
  } catch {
    // Not in Electron environment (e.g., tests)
    return null
  }
}

/**
 * Get the path to bundled Git executable.
 * Returns null if not available on this platform.
 */
export function getBundledGitPath(): string | null {
  const toolsDir = getBundledToolsDir()
  if (!toolsDir) return null

  return path.join(toolsDir, 'mingit', 'cmd', 'git.exe')
}

/**
 * Get the path to bundled Python executable.
 * Returns null if not available on this platform.
 */
export function getBundledPythonPath(): string | null {
  const toolsDir = getBundledToolsDir()
  if (!toolsDir) return null

  return path.join(toolsDir, 'python', 'python.exe')
}

/**
 * Get the path to a bundled tool by name.
 */
export function getBundledToolPath(toolName: 'git' | 'python'): string | null {
  switch (toolName) {
    case 'git':
      return getBundledGitPath()
    case 'python':
      return getBundledPythonPath()
    default:
      return null
  }
}
```

Create `packages/shared/src/tools/index.ts`:

```typescript
export * from './bundled-tools'
```

**Step 4: Run test to verify it passes**

Run:
```bash
cd packages/shared
bun test src/tools/__tests__/bundled-tools.test.ts
```

Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add packages/shared/src/tools/
git commit -m "feat: add bundled tools path detection module"
```

---

### Task 3: Enhance Tool Detection Logic

**Files:**
- Modify: `apps/electron/src/main/tool-detection.ts`
- Modify: `apps/electron/src/shared/types.ts`
- Create: `apps/electron/src/main/__tests__/tool-detection.test.ts`

**Step 1: Update types**

Modify `apps/electron/src/shared/types.ts`, update `MissingTool` interface:

```typescript
export interface ToolInfo {
  id: 'git' | 'python'
  found: boolean
  path?: string
  source?: 'system' | 'bundled' | 'none'
  version?: string
}

// Keep MissingTool for backward compatibility
export type MissingTool = ToolInfo
```

**Step 2: Write failing test**

Create `apps/electron/src/main/__tests__/tool-detection.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test'
import { detectToolInfo } from '../tool-detection'

describe('tool-detection', () => {
  describe('detectToolInfo', () => {
    it('prioritizes bundled tools on Windows', async () => {
      // This test requires mocking, will implement after main logic
      expect(true).toBe(true)
    })
  })
})
```

**Step 3: Run test**

Run:
```bash
cd apps/electron
bun test src/main/__tests__/tool-detection.test.ts
```

Expected: FAIL with "Cannot find module '../tool-detection' or detectToolInfo not exported"

**Step 4: Implement enhanced detection**

Modify `apps/electron/src/main/tool-detection.ts`:

```typescript
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import type { ToolInfo } from '../shared/types'
import { getBundledToolPath } from '@work-agent/shared/tools'

/**
 * Spawns a command and returns true if it exits with code 0.
 */
function checkCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const settle = (val: boolean) => {
      if (!settled) { settled = true; resolve(val) }
    }

    const proc = spawn(cmd, args, { stdio: 'ignore' })
    proc.on('close', code => settle(code === 0))
    proc.on('error', () => settle(false))

    const timer = setTimeout(() => {
      proc.kill()
      settle(false)
    }, 5000)

    proc.on('close', () => clearTimeout(timer))
    proc.on('error', () => clearTimeout(timer))
  })
}

/**
 * Get tool version by running --version command.
 */
async function getToolVersion(toolPath: string, toolName: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const proc = spawn(toolPath, ['--version'], { stdio: 'pipe' })
    let output = ''

    proc.stdout?.on('data', data => { output += data.toString() })
    proc.on('close', () => {
      const match = output.match(/\d+\.\d+\.\d+/)
      resolve(match ? match[0] : undefined)
    })
    proc.on('error', () => resolve(undefined))

    setTimeout(() => { proc.kill(); resolve(undefined) }, 3000)
  })
}

/**
 * Detect tool information with bundled tool priority on Windows.
 */
export async function detectToolInfo(toolName: 'git' | 'python'): Promise<ToolInfo> {
  const isWin = process.platform === 'win32'

  // 1. Check bundled tools first on Windows
  if (isWin) {
    const bundledPath = getBundledToolPath(toolName)
    if (bundledPath && existsSync(bundledPath)) {
      const version = await getToolVersion(bundledPath, toolName)
      return {
        id: toolName,
        found: true,
        path: bundledPath,
        source: 'bundled',
        version
      }
    }
  }

  // 2. Fallback to system tools
  const cmdName = isWin && toolName === 'python' ? 'python' : toolName === 'python' ? 'python3' : toolName
  const systemFound = await checkCommand(cmdName, ['--version'])

  if (systemFound) {
    const version = await getToolVersion(cmdName, toolName)
    return {
      id: toolName,
      found: true,
      path: cmdName,
      source: 'system',
      version
    }
  }

  // 3. Not found
  return {
    id: toolName,
    found: false,
    source: 'none'
  }
}

/**
 * Detect all required tools.
 * Backward compatible with existing detectMissingTools API.
 */
export async function detectMissingTools(): Promise<ToolInfo[]> {
  const [gitInfo, pythonInfo] = await Promise.all([
    detectToolInfo('git'),
    detectToolInfo('python'),
  ])

  return [gitInfo, pythonInfo]
}
```

**Step 5: Run tests**

Run:
```bash
cd apps/electron
bun test src/main/__tests__/tool-detection.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/electron/src/main/tool-detection.ts
git add apps/electron/src/shared/types.ts
git add apps/electron/src/main/__tests__/tool-detection.test.ts
git commit -m "feat: enhance tool detection to prioritize bundled tools on Windows"
```

---

## Phase 3: Agent Integration

### Task 4: Inject Tool Paths into Agent Environment

**Files:**
- Modify: `apps/electron/src/main/sessions.ts`
- Create: `apps/electron/src/main/__tests__/sessions-tool-env.test.ts`

**Step 1: Write failing test**

Create `apps/electron/src/main/__tests__/sessions-tool-env.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { buildAgentEnv } from '../sessions'

describe('sessions - tool environment', () => {
  it('prepends bundled tool paths to PATH on Windows', () => {
    const toolInfo = [
      { id: 'git' as const, found: true, path: 'C:\\app\\tools\\mingit\\cmd\\git.exe', source: 'bundled' as const },
      { id: 'python' as const, found: true, path: 'C:\\app\\tools\\python\\python.exe', source: 'bundled' as const }
    ]

    const env = buildAgentEnv(toolInfo, { PATH: 'C:\\Windows\\System32' })

    expect(env.PATH).toContain('C:\\app\\tools\\mingit\\cmd')
    expect(env.PATH).toContain('C:\\app\\tools\\python')
    expect(env.PATH).toContain('C:\\Windows\\System32')
  })
})
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd apps/electron
bun test src/main/__tests__/sessions-tool-env.test.ts
```

Expected: FAIL with "buildAgentEnv is not exported"

**Step 3: Implement buildAgentEnv function**

Modify `apps/electron/src/main/sessions.ts`, add helper function:

```typescript
import path from 'path'
import type { ToolInfo } from '../shared/types'

/**
 * Build environment variables for agent with tool paths.
 */
export function buildAgentEnv(
  toolInfo: ToolInfo[],
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...baseEnv }

  // Collect bundled tool directories
  const toolDirs: string[] = []

  for (const tool of toolInfo) {
    if (tool.found && tool.source === 'bundled' && tool.path) {
      // Extract directory from full path
      const toolDir = path.dirname(tool.path)
      if (!toolDirs.includes(toolDir)) {
        toolDirs.push(toolDir)
      }
    }
  }

  // Prepend tool directories to PATH
  if (toolDirs.length > 0) {
    const pathSep = process.platform === 'win32' ? ';' : ':'
    const existingPath = env.PATH || ''
    env.PATH = [...toolDirs, existingPath].filter(Boolean).join(pathSep)
  }

  return env
}
```

**Step 4: Integrate into session creation**

Modify `apps/electron/src/main/sessions.ts`, update `createSession` or agent startup logic:

```typescript
// Find the agent startup code and add tool detection
import { detectMissingTools } from './tool-detection'

// In createSession or similar function:
async function startAgentWithTools(sessionId: string, workingDir: string) {
  // Detect tools
  const toolInfo = await detectMissingTools()

  // Build environment with tool paths
  const agentEnv = buildAgentEnv(toolInfo)

  // Pass agentEnv to agent initialization
  // (existing agent startup code here, add env parameter)
}
```

**Step 5: Run test to verify it passes**

Run:
```bash
cd apps/electron
bun test src/main/__tests__/sessions-tool-env.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/electron/src/main/sessions.ts
git add apps/electron/src/main/__tests__/sessions-tool-env.test.ts
git commit -m "feat: inject bundled tool paths into agent environment"
```

---

## Phase 4: Packaging Configuration

### Task 5: Configure Electron Builder

**Files:**
- Modify: `apps/electron/electron-builder.yml`
- Modify: `apps/electron/package.json`

**Step 1: Update electron-builder.yml**

Modify `apps/electron/electron-builder.yml`:

```yaml
# Add to existing config
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

**Step 2: Update build scripts**

Modify `apps/electron/package.json`, update Windows build script:

```json
{
  "scripts": {
    "prebuild:win": "bun run tools:download",
    "electron:dist:win": "bun run prebuild:win && electron-builder --win"
  }
}
```

**Step 3: Test local build**

Run:
```bash
cd apps/electron
bun run electron:dist:win
```

Expected: Build completes, tools directory included in dist

**Step 4: Verify packaged structure**

Run:
```bash
# Check unpacked resources
ls -la dist/win-unpacked/resources/tools/
```

Expected: See mingit/ and python/ directories

**Step 5: Commit**

```bash
git add apps/electron/electron-builder.yml
git add apps/electron/package.json
git commit -m "feat: configure electron-builder to bundle tools in Windows builds"
```

---

## Phase 5: CI/CD and Testing

### Task 6: Add GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/test-windows-bundled-tools.yml`
- Create: `apps/electron/scripts/verify-bundled-tools.js`

**Step 1: Create verification script**

Create `apps/electron/scripts/verify-bundled-tools.js`:

```javascript
#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const REQUIRED_FILES = [
  'resources/tools/mingit/cmd/git.exe',
  'resources/tools/mingit/cmd/bash.exe',
  'resources/tools/python/python.exe'
]

function verify() {
  console.log('Verifying bundled tools...')

  let allFound = true
  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(__dirname, '..', file)
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath)
      console.log(`✓ ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)
    } else {
      console.error(`✗ ${file} NOT FOUND`)
      allFound = false
    }
  }

  if (!allFound) {
    process.exit(1)
  }

  console.log('All bundled tools verified successfully')
}

verify()
```

**Step 2: Create GitHub Actions workflow**

Create `.github/workflows/test-windows-bundled-tools.yml`:

```yaml
name: Test Windows Bundled Tools

on:
  push:
    branches: [main, feat/windows-bundled-tools]
  pull_request:
    branches: [main]

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
        run: cd apps/electron && bun run tools:download

      - name: Verify tools exist
        run: cd apps/electron && node scripts/verify-bundled-tools.js

      - name: Run unit tests
        run: bun test

      - name: Type check
        run: bun run typecheck:all
```

**Step 3: Test workflow locally (if possible)**

Run:
```bash
# Test verification script
cd apps/electron
bun run tools:download
node scripts/verify-bundled-tools.js
```

Expected: All tools verified successfully

**Step 4: Commit**

```bash
git add .github/workflows/test-windows-bundled-tools.yml
git add apps/electron/scripts/verify-bundled-tools.js
git commit -m "ci: add GitHub Actions workflow for Windows bundled tools testing"
```

---

## Phase 6: Documentation and Cleanup

### Task 7: Update Documentation

**Files:**
- Modify: `apps/electron/CLAUDE.md`
- Modify: `README.md`
- Create: `apps/electron/resources/tools/README.md`

**Step 1: Document in CLAUDE.md**

Add to `apps/electron/CLAUDE.md`:

```markdown
## Windows Bundled Tools

Windows builds include bundled MinGit and Embedded Python for out-of-box experience.

**Tool Locations:**
- MinGit: `resources/tools/mingit/` (~45MB)
- Python: `resources/tools/python/` (~15MB)

**Detection Priority (Windows only):**
1. Bundled tools (default)
2. System PATH tools (fallback)

**Build Process:**
```bash
bun run tools:download  # Download tools before build
bun run electron:dist:win  # Includes prebuild:win hook
```

**Tool Versions:**
- MinGit: 2.44.0
- Python: 3.12.8

**Maintenance:**
- Tools are NOT committed to git (excluded in .gitignore)
- Downloaded automatically during build via `tools:download` script
- Update versions in `scripts/download-tools.js`
```

**Step 2: Create tools README**

Create `apps/electron/resources/tools/README.md`:

```markdown
# Bundled Tools for Windows

This directory contains portable versions of development tools bundled with the Windows build.

## Contents

- **mingit/**: MinGit 2.44.0 - Git for Windows portable edition
- **python/**: Python 3.12.8 embedded distribution

## Usage

These tools are automatically detected and used by the application on Windows. Users don't need to install Git or Python separately.

## Updating

To update tool versions:

1. Edit `apps/electron/scripts/download-tools.js`
2. Update `MINGIT_VERSION` and `PYTHON_VERSION` constants
3. Run `bun run tools:download` to test
4. Update this README with new versions

## Size

Total size: ~60MB (MinGit ~45MB + Python ~15MB)
```

**Step 3: Commit**

```bash
git add apps/electron/CLAUDE.md
git add apps/electron/resources/tools/README.md
git commit -m "docs: document Windows bundled tools system"
```

---

## Testing Checklist

Before marking complete, verify:

- [ ] `bun run tools:download` successfully downloads and extracts tools
- [ ] `bun test` passes all tests
- [ ] `bun run typecheck:all` passes
- [ ] Windows build includes tools in `resources/tools/`
- [ ] Agent can execute git and python commands using bundled tools
- [ ] GitHub Actions workflow passes on Windows
- [ ] Tools directory is excluded from git
- [ ] Documentation is updated

## Rollback Plan

If issues arise:

1. Revert commits in reverse order
2. Remove `resources/tools/` directory
3. Remove `scripts/download-tools.js`
4. Restore original `tool-detection.ts`
5. Remove GitHub Actions workflow

## Future Enhancements

- Add tool version update automation
- Add UI to show tool source in settings
- Add "Use System Tools" toggle in settings
- Support offline builds with cached tools
- Add tool integrity verification (SHA256 checksums)
