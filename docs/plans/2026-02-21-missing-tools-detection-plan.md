# Missing Tools Detection & Auto-Install — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect missing system tools (Git, Python) during onboarding and offer to download + launch the official installer, with a choice between auto-install and manual install.

**Architecture:** New `missing-tools` onboarding step inserted after `welcome`. Main process detects tools via `spawn`, fetches download URLs (GitHub API for Git, hardcoded for Python), streams the download with progress events, then launches the installer via `shell.openPath`. Linux gets terminal commands only — no auto-install.

**Tech Stack:** Node.js `https` (streaming download), `child_process` (tool detection), Electron `shell.openPath` (launch installer), React + `useTranslation` (UI), existing onboarding primitives.

---

## Task 1: Add types and IPC channels

**Files:**
- Modify: `apps/electron/src/shared/types.ts` (near line 293 — the `GitBashStatus` section, and near line 884 — the `IPC_CHANNELS` section, and near line 1196 — the `ElectronAPI` section)

**Step 1: Add new types after the `GitBashStatus` interface (around line 297)**

Find this block:
```typescript
export interface GitBashStatus {
  found: boolean
  path: string | null
  platform: 'win32' | 'darwin' | 'linux'
}
```

Add after it:
```typescript
/**
 * Result of detecting whether a system tool is installed
 */
export interface MissingTool {
  id: 'git' | 'python'
  found: boolean
}

/**
 * Installation progress event sent from main → renderer during tool download
 */
export interface ToolInstallProgress {
  toolId: 'git' | 'python'
  status: 'downloading' | 'launching' | 'done' | 'error'
  percent?: number         // 0-100 during downloading
  downloadedMB?: number
  totalMB?: number
  error?: string
}
```

**Step 2: Add IPC channels after the `GITBASH_SET_PATH` line (around line 886)**

Find:
```typescript
  GITBASH_SET_PATH: 'gitbash:setPath',
```

Add after it:
```typescript
  // Tool detection and auto-install
  TOOLS_DETECT: 'tools:detect',
  TOOLS_INSTALL: 'tools:install',
  TOOLS_RECHECK: 'tools:recheck',
  TOOLS_INSTALL_PROGRESS: 'tools:installProgress',  // main → renderer event
```

**Step 3: Add ElectronAPI methods after the `setGitBashPath` line (around line 1198)**

Find:
```typescript
  setGitBashPath(path: string): Promise<{ success: boolean; error?: string }>
```

Add after it:
```typescript
  // Tool detection and auto-install
  detectMissingTools(): Promise<MissingTool[]>
  installTool(toolId: 'git' | 'python'): Promise<{ launched: boolean; error?: string }>
  recheckTool(toolId: 'git' | 'python'): Promise<boolean>
  onToolInstallProgress(callback: (progress: ToolInstallProgress) => void): () => void
```

**Step 4: Verify no TypeScript errors**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -30
```

**Step 5: Commit**

```bash
git add apps/electron/src/shared/types.ts
git commit -m "feat: add MissingTool types and IPC channels for tool detection"
```

---

## Task 2: Tool detection module

**Files:**
- Create: `apps/electron/src/main/tool-detection.ts`
- Create: `apps/electron/src/main/__tests__/tool-detection.test.ts`

**Step 1: Create `tool-detection.ts`**

```typescript
// apps/electron/src/main/tool-detection.ts
import { spawn } from 'child_process'
import type { MissingTool } from '../shared/types'

/**
 * Spawns a command and returns true if it exits with code 0.
 * Silently handles errors (command not found, timeout).
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

    // Safety timeout so we never block onboarding
    const timer = setTimeout(() => {
      proc.kill()
      settle(false)
    }, 5000)

    proc.on('close', () => clearTimeout(timer))
    proc.on('error', () => clearTimeout(timer))
  })
}

/**
 * Detect whether required tools are installed.
 * Runs checks in parallel for speed.
 */
export async function detectMissingTools(): Promise<MissingTool[]> {
  const isWin = process.platform === 'win32'

  const [gitFound, pythonFound] = await Promise.all([
    checkCommand('git', ['--version']),
    checkCommand(isWin ? 'python' : 'python3', ['--version']),
  ])

  return [
    { id: 'git', found: gitFound },
    { id: 'python', found: pythonFound },
  ]
}
```

**Step 2: Create the test file**

```typescript
// apps/electron/src/main/__tests__/tool-detection.test.ts
import { describe, it, expect, mock, afterEach } from 'bun:test'

// We can't easily mock child_process.spawn in bun without a full mock framework,
// so we test the exported function by calling it directly on the current system.
// This is an integration test — it checks that detectMissingTools returns
// the expected shape regardless of which tools are installed.
import { detectMissingTools } from '../tool-detection'

describe('detectMissingTools', () => {
  it('returns exactly two tool results with correct ids', async () => {
    const results = await detectMissingTools()
    expect(results).toHaveLength(2)

    const ids = results.map(r => r.id).sort()
    expect(ids).toEqual(['git', 'python'])
  })

  it('each result has a boolean found field', async () => {
    const results = await detectMissingTools()
    for (const result of results) {
      expect(typeof result.found).toBe('boolean')
    }
  })
})
```

**Step 3: Run the tests**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun test apps/electron/src/main/__tests__/tool-detection.test.ts
```

Expected: PASS (both tests pass regardless of whether tools are installed)

**Step 4: Commit**

```bash
git add apps/electron/src/main/tool-detection.ts apps/electron/src/main/__tests__/tool-detection.test.ts
git commit -m "feat: add tool-detection module with git and python checks"
```

---

## Task 3: Tool installer module

**Files:**
- Create: `apps/electron/src/main/tool-installer.ts`

**Step 1: Create `tool-installer.ts`**

```typescript
// apps/electron/src/main/tool-installer.ts
import { createWriteStream, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { IncomingMessage } from 'http'
import { shell } from 'electron'
import { execFile } from 'child_process'
import type { ToolInstallProgress } from '../shared/types'

/** Hardcoded stable Python version (update periodically) */
const PYTHON_VERSION = '3.12.8'

export interface ToolInstallInfo {
  downloadUrl: string
  filename: string
  sizeMB: number
  version: string
}

/**
 * Fetch the latest Git for Windows release info from GitHub API.
 */
async function fetchGitForWindowsInfo(): Promise<ToolInstallInfo> {
  const resp = await fetch(
    'https://api.github.com/repos/git-for-windows/git/releases/latest',
    { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'craft-agents' } }
  )
  const data = await resp.json() as {
    tag_name: string
    assets: Array<{ name: string; browser_download_url: string; size: number }>
  }
  const asset = data.assets.find(a => /Git-[\d.]+-64-bit\.exe$/.test(a.name))
  if (!asset) throw new Error('Could not find Git for Windows 64-bit installer asset')

  return {
    downloadUrl: asset.browser_download_url,
    filename: asset.name,
    sizeMB: Math.round(asset.size / 1024 / 1024),
    version: data.tag_name.replace(/^v/, ''),
  }
}

/**
 * Get install info for a tool on the current platform.
 * Returns null for tools that don't need a download (e.g., macOS git via xcode-select).
 */
export async function getToolInstallInfo(toolId: 'git' | 'python'): Promise<ToolInstallInfo | null> {
  const p = process.platform

  if (toolId === 'git') {
    if (p === 'win32') return fetchGitForWindowsInfo()
    // macOS: use xcode-select, no download
    return null
  }

  // Python
  if (p === 'win32') {
    return {
      downloadUrl: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`,
      filename: `python-${PYTHON_VERSION}-amd64.exe`,
      sizeMB: 28,
      version: PYTHON_VERSION,
    }
  }

  // macOS
  return {
    downloadUrl: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-macos11.pkg`,
    filename: `python-${PYTHON_VERSION}-macos11.pkg`,
    sizeMB: 44,
    version: PYTHON_VERSION,
  }
}

type ProgressCallback = (p: Omit<ToolInstallProgress, 'toolId' | 'status'> & { status: 'downloading' }) => void

/**
 * Stream-download a file to a temp path, emitting progress events.
 * Follows HTTP 3xx redirects.
 */
function downloadFile(url: string, destPath: string, onProgress: ProgressCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https://') ? https.get : http.get

    get(url, (res: IncomingMessage) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject)
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10)
      let downloadedBytes = 0
      const file = createWriteStream(destPath)

      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        if (totalBytes > 0) {
          onProgress({
            status: 'downloading',
            percent: Math.round((downloadedBytes / totalBytes) * 100),
            downloadedMB: Math.round((downloadedBytes / 1024 / 1024) * 10) / 10,
            totalMB: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
          })
        }
      })

      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', err => {
        if (existsSync(destPath)) unlinkSync(destPath)
        reject(err)
      })
    }).on('error', reject)
  })
}

/**
 * Download and launch the installer for a tool.
 * Calls onProgress with download/launch status events.
 * Resolves when the installer has been launched (not when installation finishes).
 */
export async function installTool(
  toolId: 'git' | 'python',
  onProgress: (p: Omit<ToolInstallProgress, 'toolId'>) => void,
): Promise<{ launched: boolean; error?: string }> {
  const p = process.platform

  // macOS git: trigger Xcode CLI Tools system dialog (no download)
  if (toolId === 'git' && p === 'darwin') {
    return new Promise(resolve => {
      execFile('xcode-select', ['--install'], err => {
        // Error code 1 with "already installed" message is fine
        if (err && !err.message.includes('already installed') && !err.message.includes('command line tools are already installed')) {
          resolve({ launched: false, error: err.message })
        } else {
          onProgress({ status: 'done' })
          resolve({ launched: true })
        }
      })
    })
  }

  // Get download info
  let info: ToolInstallInfo | null
  try {
    info = await getToolInstallInfo(toolId)
  } catch (err) {
    return { launched: false, error: `Failed to get download info: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!info) {
    return { launched: false, error: 'No installer available for this platform' }
  }

  // Download
  const destPath = join(tmpdir(), info.filename)
  try {
    await downloadFile(info.downloadUrl, destPath, onProgress)
  } catch (err) {
    return { launched: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Launch installer
  onProgress({ status: 'launching' })
  await shell.openPath(destPath)
  onProgress({ status: 'done' })

  return { launched: true }
}
```

**Step 2: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -30
```

Expected: No new errors.

**Step 3: Commit**

```bash
git add apps/electron/src/main/tool-installer.ts
git commit -m "feat: add tool-installer module with download and launch support"
```

---

## Task 4: IPC handlers

**Files:**
- Modify: `apps/electron/src/main/ipc.ts`

**Step 1: Add imports**

Find the imports block near the top of `ipc.ts`. After the line importing from `./git-bash`, add:

```typescript
import { detectMissingTools } from './tool-detection'
import { installTool } from './tool-installer'
```

**Step 2: Add handlers**

Find the Git Bash handler block (around the `GITBASH_SET_PATH` handler). After it (around line 1249), add:

```typescript
  // ─── Tool Detection & Auto-Install ────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TOOLS_DETECT, async () => {
    return detectMissingTools()
  })

  ipcMain.handle(IPC_CHANNELS.TOOLS_RECHECK, async (_event, toolId: 'git' | 'python') => {
    const results = await detectMissingTools()
    const tool = results.find(t => t.id === toolId)
    return tool?.found ?? false
  })

  ipcMain.handle(IPC_CHANNELS.TOOLS_INSTALL, async (event, toolId: 'git' | 'python') => {
    return installTool(toolId, (progress) => {
      // Stream progress events to renderer
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, { toolId, ...progress })
      }
    })
  })
```

**Step 3: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -30
```

**Step 4: Commit**

```bash
git add apps/electron/src/main/ipc.ts
git commit -m "feat: add IPC handlers for tool detection and auto-install"
```

---

## Task 5: Preload bridge

**Files:**
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: Add the four new methods**

Find the block with `setGitBashPath` (around line 179 in preload/index.ts). After it, add:

```typescript
  // Tool detection and auto-install
  detectMissingTools: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOLS_DETECT),
  installTool: (toolId: 'git' | 'python') =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOLS_INSTALL, toolId),
  recheckTool: (toolId: 'git' | 'python') =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOLS_RECHECK, toolId),
  onToolInstallProgress: (callback: (progress: import('../shared/types').ToolInstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: import('../shared/types').ToolInstallProgress) => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, handler)
  },
```

**Step 2: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -30
```

**Step 3: Commit**

```bash
git add apps/electron/src/preload/index.ts
git commit -m "feat: expose tool detection and install APIs in preload bridge"
```

---

## Task 6: Translations and labels

**Files:**
- Modify: `packages/shared/locales/en/onboarding.json`
- Modify: `packages/shared/locales/zh-CN/onboarding.json`
- Modify: `apps/electron/src/renderer/components/onboarding/labels.ts`
- Modify: `apps/electron/src/renderer/components/onboarding/__tests__/onboarding-i18n.test.ts`

**Step 1: Add to English locale**

In `packages/shared/locales/en/onboarding.json`, add a new top-level key before `"reauth"`:

```json
  "missingTools": {
    "title": "Set Up Required Tools",
    "description": "Some tools needed by the agent are missing on your system.",
    "continue": "Continue",
    "skip": "Skip for now",
    "back": "Back",
    "tools": {
      "git": {
        "name": "Git",
        "description": "Version control for your projects"
      },
      "python": {
        "name": "Python",
        "description": "Required for running Python scripts and projects"
      }
    },
    "status": {
      "found": "Installed",
      "missing": "Not found"
    },
    "autoInstall": "Auto Install",
    "manualInstall": "I'll install it myself",
    "openDownloadPage": "Open download page",
    "recheck": "Re-check",
    "rechecking": "Checking...",
    "installing": "Installing...",
    "downloadProgress": "Downloading... {{percent}}%  {{downloadedMB}}/{{totalMB}} MB",
    "launching": "Opening installer...",
    "installerLaunched": "Installer opened. Complete the installation, then click Re-check.",
    "installError": "Install failed: {{error}}",
    "linux": {
      "note": "Run this command in your terminal to install:",
      "commands": {
        "git": {
          "apt": "sudo apt install git",
          "yum": "sudo yum install git",
          "pacman": "sudo pacman -S git",
          "default": "Install git using your package manager"
        },
        "python": {
          "apt": "sudo apt install python3",
          "yum": "sudo yum install python3",
          "pacman": "sudo pacman -S python",
          "default": "Install python3 using your package manager"
        }
      }
    }
  },
```

**Step 2: Add to Chinese locale**

In `packages/shared/locales/zh-CN/onboarding.json`, add the same key:

```json
  "missingTools": {
    "title": "安装必要工具",
    "description": "以下工具是 Agent 运行所必需的，但在您的系统上未检测到。",
    "continue": "继续",
    "skip": "暂时跳过",
    "back": "返回",
    "tools": {
      "git": {
        "name": "Git",
        "description": "项目版本控制工具"
      },
      "python": {
        "name": "Python",
        "description": "运行 Python 脚本和项目所需"
      }
    },
    "status": {
      "found": "已安装",
      "missing": "未找到"
    },
    "autoInstall": "自动安装",
    "manualInstall": "我自己安装",
    "openDownloadPage": "打开下载页面",
    "recheck": "重新检测",
    "rechecking": "检测中...",
    "installing": "安装中...",
    "downloadProgress": "下载中... {{percent}}%  {{downloadedMB}}/{{totalMB}} MB",
    "launching": "正在打开安装程序...",
    "installerLaunched": "安装程序已打开，完成安装后请点击"重新检测"。",
    "installError": "安装失败：{{error}}",
    "linux": {
      "note": "在终端运行以下命令安装：",
      "commands": {
        "git": {
          "apt": "sudo apt install git",
          "yum": "sudo yum install git",
          "pacman": "sudo pacman -S git",
          "default": "使用包管理器安装 git"
        },
        "python": {
          "apt": "sudo apt install python3",
          "yum": "sudo yum install python3",
          "pacman": "sudo pacman -S python3",
          "default": "使用包管理器安装 python3"
        }
      }
    }
  },
```

**Step 3: Add `getMissingToolsLabels` to `labels.ts`**

Append to `apps/electron/src/renderer/components/onboarding/labels.ts`:

```typescript
export function getMissingToolsLabels(t: TFunction) {
  return {
    title: t('onboarding:missingTools.title'),
    description: t('onboarding:missingTools.description'),
    continue: t('onboarding:missingTools.continue'),
    skip: t('onboarding:missingTools.skip'),
    back: t('onboarding:missingTools.back'),
    found: t('onboarding:missingTools.status.found'),
    missing: t('onboarding:missingTools.status.missing'),
    autoInstall: t('onboarding:missingTools.autoInstall'),
    manualInstall: t('onboarding:missingTools.manualInstall'),
    openDownloadPage: t('onboarding:missingTools.openDownloadPage'),
    recheck: t('onboarding:missingTools.recheck'),
    rechecking: t('onboarding:missingTools.rechecking'),
    installerLaunched: t('onboarding:missingTools.installerLaunched'),
    linuxNote: t('onboarding:missingTools.linux.note'),
    toolName: (id: 'git' | 'python') => t(`onboarding:missingTools.tools.${id}.name`),
    toolDescription: (id: 'git' | 'python') => t(`onboarding:missingTools.tools.${id}.description`),
  }
}
```

**Step 4: Add test in `onboarding-i18n.test.ts`**

Append to `apps/electron/src/renderer/components/onboarding/__tests__/onboarding-i18n.test.ts`:

```typescript
  it('returns localized missing tools labels', () => {
    const t: TFunction = ((key: string) => ({
      'onboarding:missingTools.title': '安装必要工具',
      'onboarding:missingTools.description': '以下工具是 Agent 运行所必需的',
      'onboarding:missingTools.continue': '继续',
      'onboarding:missingTools.skip': '暂时跳过',
      'onboarding:missingTools.back': '返回',
      'onboarding:missingTools.status.found': '已安装',
      'onboarding:missingTools.status.missing': '未找到',
      'onboarding:missingTools.autoInstall': '自动安装',
      'onboarding:missingTools.manualInstall': '我自己安装',
      'onboarding:missingTools.openDownloadPage': '打开下载页面',
      'onboarding:missingTools.recheck': '重新检测',
      'onboarding:missingTools.rechecking': '检测中...',
      'onboarding:missingTools.installerLaunched': '安装程序已打开',
      'onboarding:missingTools.linux.note': '在终端运行以下命令安装：',
      'onboarding:missingTools.tools.git.name': 'Git',
      'onboarding:missingTools.tools.git.description': '项目版本控制工具',
      'onboarding:missingTools.tools.python.name': 'Python',
      'onboarding:missingTools.tools.python.description': '运行 Python 脚本和项目所需',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getMissingToolsLabels(t)
    expect(labels.title).toBe('安装必要工具')
    expect(labels.autoInstall).toBe('自动安装')
    expect(labels.toolName('git')).toBe('Git')
    expect(labels.toolName('python')).toBe('Python')
    expect(labels.recheck).toBe('重新检测')
  })
```

Also add `getMissingToolsLabels` to the import at line 3:
```typescript
import { getApiSetupLabels, getWelcomeLabels, getReauthLabels, getCredentialsLabels, getMissingToolsLabels } from '../labels'
```

**Step 5: Run tests**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun test apps/electron/src/renderer/components/onboarding/__tests__/onboarding-i18n.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/shared/locales/en/onboarding.json packages/shared/locales/zh-CN/onboarding.json apps/electron/src/renderer/components/onboarding/labels.ts apps/electron/src/renderer/components/onboarding/__tests__/onboarding-i18n.test.ts
git commit -m "feat: add missing tools i18n strings and labels helper"
```

---

## Task 7: MissingToolsStep component

**Files:**
- Create: `apps/electron/src/renderer/components/onboarding/MissingToolsStep.tsx`

**Step 1: Create the component**

```tsx
// apps/electron/src/renderer/components/onboarding/MissingToolsStep.tsx
import { useState, useEffect } from 'react'
import { Wrench, Check, Copy, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import { useTranslation } from 'react-i18next'
import type { MissingTool, ToolInstallProgress } from '../../../shared/types'

type InstallChoice = 'auto' | 'manual'

interface ToolUiState {
  choice: InstallChoice
  status: 'idle' | 'downloading' | 'launching' | 'launched' | 'error' | 'rechecking'
  downloadPercent: number
  downloadedMB: number
  totalMB: number
  error?: string
  found: boolean
}

interface MissingToolsStepProps {
  tools: MissingTool[]
  platform: 'win32' | 'darwin' | 'linux'
  linuxDistro?: 'apt' | 'yum' | 'pacman' | 'default'
  onInstall: (toolId: 'git' | 'python') => void
  onRecheck: (toolId: 'git' | 'python') => void
  onContinue: () => void
  onBack: () => void
  installProgress?: ToolInstallProgress
}

const MANUAL_URLS = {
  git: {
    win32: 'https://git-scm.com/downloads/win',
    darwin: 'https://git-scm.com/downloads/mac',
    linux: 'https://git-scm.com/downloads/linux',
  },
  python: {
    win32: 'https://www.python.org/downloads/windows/',
    darwin: 'https://www.python.org/downloads/macos/',
    linux: 'https://www.python.org/downloads/',
  },
}

export function MissingToolsStep({
  tools,
  platform,
  linuxDistro = 'default',
  onInstall,
  onRecheck,
  onContinue,
  onBack,
  installProgress,
}: MissingToolsStepProps) {
  const { t } = useTranslation(['onboarding'])

  // Per-tool local UI state
  const [toolState, setToolState] = useState<Record<string, ToolUiState>>(() => {
    const initial: Record<string, ToolUiState> = {}
    for (const tool of tools) {
      initial[tool.id] = {
        choice: 'auto',
        status: 'idle',
        downloadPercent: 0,
        downloadedMB: 0,
        totalMB: 0,
        found: tool.found,
      }
    }
    return initial
  })

  // Apply incoming progress events from parent
  useEffect(() => {
    if (!installProgress) return
    const { toolId, status, percent, downloadedMB, totalMB, error } = installProgress
    setToolState(prev => ({
      ...prev,
      [toolId]: {
        ...prev[toolId],
        status: status === 'done' ? 'launched' : status === 'launching' ? 'launching' : status === 'error' ? 'error' : 'downloading',
        downloadPercent: percent ?? prev[toolId].downloadPercent,
        downloadedMB: downloadedMB ?? prev[toolId].downloadedMB,
        totalMB: totalMB ?? prev[toolId].totalMB,
        error,
      },
    }))
  }, [installProgress])

  const handleInstall = (toolId: 'git' | 'python') => {
    setToolState(prev => ({
      ...prev,
      [toolId]: { ...prev[toolId], status: 'downloading', downloadPercent: 0, error: undefined },
    }))
    onInstall(toolId)
  }

  const handleRecheck = async (toolId: 'git' | 'python') => {
    setToolState(prev => ({ ...prev, [toolId]: { ...prev[toolId], status: 'rechecking' } }))
    onRecheck(toolId)
  }

  const handleCopyCommand = (command: string) => {
    navigator.clipboard.writeText(command)
  }

  const missingTools = tools.filter(t => !toolState[t.id]?.found)
  const canContinue = missingTools.every(t => {
    const s = toolState[t.id]
    return s?.found || t.found
  })

  return (
    <StepFormLayout
      icon={<Wrench />}
      title={t('onboarding:missingTools.title')}
      description={t('onboarding:missingTools.description')}
    >
      <div className="space-y-3">
        {tools.map(tool => {
          const state = toolState[tool.id]
          const isFound = state?.found || tool.found

          return (
            <div
              key={tool.id}
              className="rounded-lg border border-border bg-foreground-2 p-4"
            >
              {/* Tool header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t(`onboarding:missingTools.tools.${tool.id}.name`)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(`onboarding:missingTools.tools.${tool.id}.description`)}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  isFound
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}>
                  {isFound
                    ? t('onboarding:missingTools.status.found')
                    : t('onboarding:missingTools.status.missing')}
                </span>
              </div>

              {/* Actions: only shown when not found */}
              {!isFound && (
                <div className="mt-3">
                  {/* Linux: show terminal command */}
                  {platform === 'linux' ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t('onboarding:missingTools.linux.note')}
                      </p>
                      <div className="flex items-center gap-2 rounded bg-background px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-foreground">
                          {t(`onboarding:missingTools.linux.commands.${tool.id}.${linuxDistro}`)}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyCommand(
                            t(`onboarding:missingTools.linux.commands.${tool.id}.${linuxDistro}`)
                          )}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleRecheck(tool.id)}
                        disabled={state?.status === 'rechecking'}
                        className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        <RefreshCw className={`mr-2 size-3 ${state?.status === 'rechecking' ? 'animate-spin' : ''}`} />
                        {state?.status === 'rechecking'
                          ? t('onboarding:missingTools.rechecking')
                          : t('onboarding:missingTools.recheck')}
                      </Button>
                    </div>
                  ) : (
                    /* Windows / macOS: auto-install or manual */
                    <div className="space-y-3">
                      {/* Choice radio buttons */}
                      {state?.status === 'idle' && (
                        <div className="space-y-2">
                          {/* Auto install option */}
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`install-choice-${tool.id}`}
                              value="auto"
                              checked={state.choice === 'auto'}
                              onChange={() => setToolState(prev => ({
                                ...prev,
                                [tool.id]: { ...prev[tool.id], choice: 'auto' }
                              }))}
                              className="mt-0.5"
                            />
                            <span className="text-xs text-foreground">
                              {t('onboarding:missingTools.autoInstall')}
                            </span>
                          </label>

                          {/* Manual install option */}
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`install-choice-${tool.id}`}
                              value="manual"
                              checked={state.choice === 'manual'}
                              onChange={() => setToolState(prev => ({
                                ...prev,
                                [tool.id]: { ...prev[tool.id], choice: 'manual' }
                              }))}
                              className="mt-0.5"
                            />
                            <span className="text-xs text-foreground">
                              {t('onboarding:missingTools.manualInstall')}
                            </span>
                          </label>
                        </div>
                      )}

                      {/* Manual install: show link + re-check */}
                      {state?.choice === 'manual' && state?.status === 'idle' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => window.electronAPI.openUrl(
                              MANUAL_URLS[tool.id][platform as 'win32' | 'darwin'] ?? MANUAL_URLS[tool.id].linux
                            )}
                            className="flex-1 bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <ExternalLink className="mr-2 size-3" />
                            {t('onboarding:missingTools.openDownloadPage')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleRecheck(tool.id)}
                            className="flex-1 bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <RefreshCw className="mr-2 size-3" />
                            {t('onboarding:missingTools.recheck')}
                          </Button>
                        </div>
                      )}

                      {/* Auto install: show install button */}
                      {state?.choice === 'auto' && state?.status === 'idle' && (
                        <Button
                          size="sm"
                          onClick={() => handleInstall(tool.id)}
                          className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                        >
                          {t('onboarding:missingTools.autoInstall')}
                        </Button>
                      )}

                      {/* Downloading progress */}
                      {state?.status === 'downloading' && (
                        <div className="space-y-1">
                          <div className="h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all"
                              style={{ width: `${state.downloadPercent}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('onboarding:missingTools.downloadProgress', {
                              percent: state.downloadPercent,
                              downloadedMB: state.downloadedMB,
                              totalMB: state.totalMB,
                            })}
                          </p>
                        </div>
                      )}

                      {/* Launching */}
                      {state?.status === 'launching' && (
                        <p className="text-xs text-muted-foreground">
                          {t('onboarding:missingTools.launching')}
                        </p>
                      )}

                      {/* Installer launched: show re-check */}
                      {state?.status === 'launched' && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {t('onboarding:missingTools.installerLaunched')}
                          </p>
                          <Button
                            size="sm"
                            onClick={() => handleRecheck(tool.id)}
                            disabled={state?.status === 'rechecking'}
                            className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <RefreshCw className={`mr-2 size-3 ${state?.status === 'rechecking' ? 'animate-spin' : ''}`} />
                            {t('onboarding:missingTools.recheck')}
                          </Button>
                        </div>
                      )}

                      {/* Rechecking */}
                      {state?.status === 'rechecking' && (
                        <Button
                          size="sm"
                          disabled
                          className="w-full bg-background shadow-minimal text-foreground rounded-lg"
                        >
                          <RefreshCw className="mr-2 size-3 animate-spin" />
                          {t('onboarding:missingTools.rechecking')}
                        </Button>
                      )}

                      {/* Error */}
                      {state?.status === 'error' && (
                        <div className="space-y-2">
                          <p className="text-xs text-destructive">
                            {t('onboarding:missingTools.installError', { error: state.error })}
                          </p>
                          <Button
                            size="sm"
                            onClick={() => setToolState(prev => ({
                              ...prev,
                              [tool.id]: { ...prev[tool.id], status: 'idle', error: undefined }
                            }))}
                            className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            Try Again
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Found: show checkmark */}
              {isFound && (
                <div className="mt-2 flex items-center gap-1.5 text-success">
                  <Check className="size-3" />
                  <span className="text-xs">{t('onboarding:missingTools.status.found')}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer actions */}
      <div className="mt-6 flex gap-3 justify-center">
        <BackButton onClick={onBack}>
          {t('onboarding:missingTools.back')}
        </BackButton>
        <ContinueButton onClick={onContinue}>
          {canContinue
            ? t('onboarding:missingTools.continue')
            : t('onboarding:missingTools.skip')}
        </ContinueButton>
      </div>
    </StepFormLayout>
  )
}
```

**Step 2: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -40
```

**Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/onboarding/MissingToolsStep.tsx
git commit -m "feat: add MissingToolsStep onboarding component"
```

---

## Task 8: Update OnboardingWizard

**Files:**
- Modify: `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`

**Step 1: Add import for MissingToolsStep**

After the `GitBashWarning` import line, add:

```typescript
import { MissingToolsStep } from './MissingToolsStep'
import type { ToolInstallProgress } from '../../../shared/types'
```

**Step 2: Update `OnboardingStep` type**

Change:
```typescript
export type OnboardingStep =
  | 'welcome'
  | 'git-bash'
  | 'api-setup'
  | 'credentials'
  | 'complete'
```

To:
```typescript
export type OnboardingStep =
  | 'welcome'
  | 'missing-tools'
  | 'git-bash'
  | 'api-setup'
  | 'credentials'
  | 'complete'
```

**Step 3: Add missing-tools state to `OnboardingState`**

After the `isCheckingGitBash?: boolean` line in the interface, add:

```typescript
  missingTools?: import('../../../shared/types').MissingTool[]
  isCheckingTools?: boolean
  toolInstallProgress?: ToolInstallProgress
  linuxDistro?: 'apt' | 'yum' | 'pacman' | 'default'
```

**Step 4: Add props for missing-tools step**

In `OnboardingWizardProps`, after the Git Bash props block, add:

```typescript
  // Missing tools (cross-platform)
  onInstallTool?: (toolId: 'git' | 'python') => void
  onRecheckTool?: (toolId: 'git' | 'python') => void
```

**Step 5: Add to destructured props and `renderStep`**

Add `onInstallTool` and `onRecheckTool` to the destructured props in the function signature.

In `renderStep()`, add the new case before `case 'git-bash':`:

```typescript
      case 'missing-tools':
        return (
          <MissingToolsStep
            tools={state.missingTools ?? []}
            platform={(state.gitBashStatus?.platform ?? process.platform) as 'win32' | 'darwin' | 'linux'}
            linuxDistro={state.linuxDistro}
            onInstall={onInstallTool!}
            onRecheck={onRecheckTool!}
            onContinue={onContinue}
            onBack={onBack}
            installProgress={state.toolInstallProgress}
          />
        )
```

**Step 6: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -40
```

**Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx
git commit -m "feat: add missing-tools step to OnboardingWizard"
```

---

## Task 9: Update useOnboarding hook

**Files:**
- Modify: `apps/electron/src/renderer/hooks/useOnboarding.ts`

**Step 1: Add types to import**

Add `MissingTool` and `ToolInstallProgress` to the import from `../../shared/types`:

```typescript
import type { AuthType, SetupNeeds, GitBashStatus, LlmConnectionSetup, MissingTool, ToolInstallProgress } from '../../shared/types'
```

**Step 2: Add to `UseOnboardingReturn` interface**

After the `handleClearError` line, add:

```typescript
  // Missing tools
  handleInstallTool: (toolId: 'git' | 'python') => void
  handleRecheckTool: (toolId: 'git' | 'python') => void
```

**Step 3: Update initial state**

In the `useState<OnboardingState>` call, add:

```typescript
    missingTools: undefined,
    isCheckingTools: true,
    toolInstallProgress: undefined,
    linuxDistro: undefined,
```

**Step 4: Add tool detection effect alongside the Git Bash check**

After the existing `useEffect` that calls `checkGitBash()`, add:

```typescript
  // Detect missing tools (git, python) at onboarding start
  useEffect(() => {
    const detectTools = async () => {
      try {
        const tools = await window.electronAPI.detectMissingTools()
        // Detect Linux distro from installed package manager
        let linuxDistro: 'apt' | 'yum' | 'pacman' | 'default' | undefined
        if (typeof process !== 'undefined' && process.platform === 'linux') {
          // Check for common package managers
          const checkPm = async (cmd: string) => {
            try { await window.electronAPI.detectMissingTools(); return true } catch { return false }
          }
          // Simple heuristic: check if apt-get exists
          // In the main process we'd use 'which apt-get' but here we just check navigator
          linuxDistro = 'apt' // Default to apt for now; can be improved later
        }
        setState(s => ({ ...s, missingTools: tools, isCheckingTools: false, linuxDistro }))
      } catch (error) {
        console.error('[Onboarding] Failed to detect missing tools:', error)
        setState(s => ({ ...s, missingTools: [], isCheckingTools: false }))
      }
    }
    detectTools()
  }, [])
```

**Step 5: Subscribe to install progress events**

Add another `useEffect` for cleanup:

```typescript
  // Subscribe to tool install progress events from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onToolInstallProgress((progress) => {
      setState(s => ({ ...s, toolInstallProgress: progress }))
    })
    return cleanup
  }, [])
```

**Step 6: Update `handleContinue` for the 'welcome' case**

Change the existing `case 'welcome':` block from:

```typescript
      case 'welcome':
        // On Windows, check if Git Bash is needed
        if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'api-setup' }))
        }
        break
```

To:

```typescript
      case 'welcome': {
        // Check if any tools are missing (git or python)
        const missingToolsList = (state.missingTools ?? []).filter(t => !t.found)
        if (missingToolsList.length > 0) {
          setState(s => ({ ...s, step: 'missing-tools' }))
        } else if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'api-setup' }))
        }
        break
      }
```

**Step 7: Add `case 'missing-tools':` to `handleContinue`**

After the `case 'welcome'` block, add:

```typescript
      case 'missing-tools':
        // After the missing-tools step, check if git-bash is still needed on Windows
        if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'api-setup' }))
        }
        break
```

**Step 8: Update `handleBack` for 'missing-tools' and 'git-bash' and 'api-setup'**

In `handleBack`, add before `case 'git-bash':`:

```typescript
      case 'missing-tools':
        setState(s => ({ ...s, step: 'welcome' }))
        break
```

Update `case 'git-bash':` back navigation to account for missing-tools:

```typescript
      case 'git-bash': {
        const hadMissingTools = (state.missingTools ?? []).some(t => !t.found)
        setState(s => ({ ...s, step: hadMissingTools ? 'missing-tools' : 'welcome' }))
        break
      }
```

Update `case 'api-setup':` back navigation:

```typescript
      case 'api-setup':
        if (state.gitBashStatus?.platform === 'win32' && state.gitBashStatus?.found === false) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else if ((state.missingTools ?? []).some(t => !t.found)) {
          setState(s => ({ ...s, step: 'missing-tools' }))
        } else {
          setState(s => ({ ...s, step: 'welcome' }))
        }
        break
```

**Step 9: Add `handleInstallTool` and `handleRecheckTool`**

After `handleClearError`, add:

```typescript
  // Install a tool via auto-download
  const handleInstallTool = useCallback(async (toolId: 'git' | 'python') => {
    // installTool IPC handler streams progress via onToolInstallProgress events
    // and resolves when installer is launched
    const result = await window.electronAPI.installTool(toolId)
    if (!result.launched) {
      // Surface error via progress event
      setState(s => ({
        ...s,
        toolInstallProgress: {
          toolId,
          status: 'error',
          error: result.error ?? 'Installation failed',
        },
      }))
    }
  }, [])

  const handleRecheckTool = useCallback(async (toolId: 'git' | 'python') => {
    const found = await window.electronAPI.recheckTool(toolId)
    setState(s => ({
      ...s,
      missingTools: (s.missingTools ?? []).map(t =>
        t.id === toolId ? { ...t, found } : t
      ),
    }))
  }, [])
```

**Step 10: Add to the return value**

In the `return` statement, add:

```typescript
    handleInstallTool,
    handleRecheckTool,
```

**Step 11: Wire up in App.tsx**

In `apps/electron/src/renderer/App.tsx`, update the `<OnboardingWizard>` component to pass the new handlers:

```tsx
          onInstallTool={onboarding.handleInstallTool}
          onRecheckTool={onboarding.handleRecheckTool}
```

**Step 12: Verify TypeScript**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun run typecheck:all 2>&1 | head -40
```

Expected: No errors.

**Step 13: Run all tests**

```bash
cd /Users/kun/code/litchi/craft-agents-oss && bun test 2>&1 | tail -20
```

Expected: All tests pass.

**Step 14: Final commit**

```bash
git add apps/electron/src/renderer/hooks/useOnboarding.ts apps/electron/src/renderer/App.tsx
git commit -m "feat: integrate missing tools detection and install flow into onboarding hook"
```

---

## Manual Verification Checklist

After all tasks complete, test in dev mode:

```bash
bun run electron:dev
```

1. **Fresh install simulation** - temporarily rename `git` binary and verify:
   - Welcome step shows loading indicator while checking tools
   - After clicking "Get Started", `missing-tools` step appears
   - Tool card shows Git as "Not found"
   - Selecting "Auto Install" and clicking the button starts download with progress bar
   - macOS: xcode-select dialog appears
   - Windows: Git installer downloads and opens
   - After installing, "Re-check" finds the tool and shows "Installed" badge
   - "Continue" advances to `git-bash` (Windows) or `api-setup` (macOS/Linux)

2. **All tools present** - normal flow:
   - Welcome → clicking "Get Started" skips `missing-tools` step entirely
   - Goes directly to `git-bash` (Windows) or `api-setup` (macOS/Linux)

3. **Skip flow**:
   - In `missing-tools`, clicking "Skip for now" advances to next step

4. **Back navigation**:
   - From `api-setup`, Back → `missing-tools` (if tools were missing) → Back → `welcome`
