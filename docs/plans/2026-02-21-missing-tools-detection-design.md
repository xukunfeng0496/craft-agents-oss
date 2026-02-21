# Missing Tools Detection & Auto-Install

**Date:** 2026-02-21
**Status:** Approved

## Problem

On some devices (especially Windows), common tools like Git and Python may not be installed. When the agent tries to use them, it fails silently or with cryptic errors. We want an elegant onboarding experience that detects missing tools, lets users choose to auto-install or self-install, and guides them through the process.

## Scope

| Platform | Tools to Check |
|----------|---------------|
| Windows  | Git (via Git Bash) + Python |
| macOS    | git + python3 |
| Linux    | git + python3 (show install commands only, no auto-install) |

Git Bash on Windows already has an existing onboarding step — the new `missing-tools` step will absorb and replace this detection logic.

## Architecture

```
Onboarding Wizard (Renderer)
    ↓ IPC
Main Process: Tool Detection + Downloader
    ↓ file system / child_process
Official Installer (.exe / .pkg / xcode-select)
```

### Onboarding Step Order (modified)

```
welcome
  ↓
missing-tools   ← NEW (detect git/python, guide installation)
  ↓
git-bash        ← Windows only; skipped if missing-tools already handled git
  ↓
api-setup
  ↓
credentials
  ↓
completion
```

## New Files

- `apps/electron/src/main/tool-detection.ts` — detect missing tools
- `apps/electron/src/main/tool-installer.ts` — download + launch installer
- `apps/electron/src/renderer/components/onboarding/MissingToolsStep.tsx` — UI component

## Modified Files

- `apps/electron/src/shared/types.ts` — add IPC channels + types
- `apps/electron/src/main/ipc.ts` — implement IPC handlers
- `apps/electron/src/preload/index.ts` — expose to renderer
- `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx` — add step

## Detection Logic

```typescript
// tool-detection.ts
// Spawn command, check exit code
const checks = [
  { id: 'git',    cmd: 'git --version',     platforms: ['win32', 'darwin', 'linux'] },
  { id: 'python', cmd: 'python3 --version', platforms: ['darwin', 'linux'] },
  { id: 'python', cmd: 'python --version',  platforms: ['win32'] },
]
// exit code != 0 or spawn failure → marked as missing
```

On Windows, git detection reuses existing Git Bash path logic from `git-bash.ts`.

## Download Sources

| Tool | Platform | Source |
|------|----------|--------|
| Git for Windows | win32 | GitHub Releases API (`git-for-windows/git`) |
| Python | win32 | python.org `/ftp/python/` latest |
| Git | macOS | `xcode-select --install` (system command, no download) |
| Python | macOS | python.org `.pkg` |
| Git + Python | Linux | Show terminal command only (distro variety) |

Linux distro detection via `/etc/os-release` to show the right command (`apt`, `yum`, `pacman`, etc.).

## Install Flow

```
1. Query GitHub / python.org API → get latest version + URL
2. Stream download to OS temp dir, emit progress events
3. On completion:
   - Windows .exe → shell.openPath()
   - macOS .pkg   → shell.openPath()
   - macOS git    → spawn xcode-select --install (triggers system dialog)
4. Re-check tool after installer exits → confirm success
```

## IPC Channels

```typescript
DETECT_MISSING_TOOLS   // → MissingTool[]
GET_TOOL_DOWNLOAD_URL  // → { url, version, sizeMB }
INSTALL_TOOL           // streams progress via 'tool-install-progress' events
RECHECK_TOOL           // → { installed: boolean }
```

## Data Types

```typescript
interface MissingTool {
  id: 'git' | 'python'
  name: string
  description: string
  sizeMB?: number        // shown in auto-install option
  downloadUrl?: string   // resolved at install time
  manualUrl: string      // official website link
  installCommand?: string // Linux: apt install git, etc.
}

type ToolInstallProgress = {
  toolId: string
  status: 'downloading' | 'launching' | 'done' | 'error'
  percent?: number
  error?: string
}
```

## UI Design

### Tool List (default state)

```
┌─────────────────────────────────────────────────────┐
│  Setup Required Tools                               │
│  Some tools needed for the agent are missing        │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🔧 Git                          Missing     │    │
│  │  Version control for your projects          │    │
│  │  ○ Auto Install  (download v2.47, ~57MB)    │    │
│  │  ○ I'll install it myself                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🐍 Python                       Missing     │    │
│  │  Required for Python projects               │    │
│  │  ○ Auto Install  (download v3.13, ~28MB)    │    │
│  │  ○ I'll install it myself                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  [ Continue ]   [ Skip for now ]                   │
└─────────────────────────────────────────────────────┘
```

### "I'll install it myself" expanded

```
│  ○ I'll install it myself   ← selected
│    Download: git-scm.com/download  [Open ↗]
│    [Re-check]
```

### Download Progress

```
┌─────────────────────────────────────────────────────┐
│  Installing Tools...                                │
│                                                     │
│  Git                                                │
│  ████████████░░░░░  Downloading... 43%  24/57MB    │
│                                                     │
│  Python                                             │
│  ░░░░░░░░░░░░░░░░░  Waiting...                     │
│                                                     │
│  Installer will launch automatically when ready.   │
└─────────────────────────────────────────────────────┘
```

After installer exits, re-check automatically. If all tools pass → advance to next step. If still missing → show retry option.

## Edge Cases

- **No internet**: show error, offer manual install links only
- **Installer cancelled by user**: re-check fails, show retry
- **Tool already installed mid-session** (user installs manually): Re-check button updates status in place
- **Linux**: auto-install not supported; show distro-appropriate command with copy button
- **Windows git already found via Git Bash**: skip git card entirely, only show python if missing
