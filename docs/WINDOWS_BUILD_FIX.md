# Windows Build Fix: Bundled Python Not Included

## Problem

When building the Windows installer using `bun run electron:dist:win`, the bundled Python (3.12.8) was not being included in the package. This caused the app to fall back to system Python, which could be outdated or missing.

**Root Cause:** The build script didn't call `tools:download` before packaging, so `resources/tools/python/` was empty.

## Solution

Modified two files to ensure tools are downloaded before every Windows build:

### 1. Root `package.json`

Changed the `electron:dist:win` script to download tools first:

```json
"electron:dist:win": "cd apps/electron && bun run tools:download && cd ../.. && bun run electron:build && electron-builder --config electron-builder.yml --project apps/electron --win"
```

### 2. `apps/electron/scripts/build-win.ps1`

Added tool download step after dependency installation (line 94-105):

```powershell
# 2.5. Download bundled tools (Python, MinGit)
Write-Host "Downloading bundled tools (Python, MinGit)..."
Push-Location $ElectronDir
try {
    node scripts/download-tools.cjs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: Tool download failed, continuing anyway..." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
```

## Verification Steps

### Before Building

1. **Clean previous downloads** (optional, to test from scratch):
   ```bash
   cd apps/electron
   rm -rf resources/tools
   ```

2. **Run the download script manually** to verify it works:
   ```bash
   cd apps/electron
   bun run tools:download
   node scripts/verify-bundled-tools.js
   ```

   Expected output:
   ```
   ✓ mingit/cmd/git.exe (XX.XX MB)
   ✓ python/python.exe (XX.XX MB)
   ```

### During Build

3. **Build the Windows installer**:
   ```bash
   # From repository root
   bun run electron:dist:win
   ```

   Watch for the new log line:
   ```
   Downloading bundled tools (Python, MinGit)...
   ```

### After Installation

4. **Check the installed app** (on Windows):
   ```powershell
   # Navigate to installation directory
   cd "C:\Users\<你>\AppData\Local\Programs\Work Agents"

   # Verify Python exists
   dir resources\app\resources\tools\python\python.exe

   # Test Python version
   .\resources\app\resources\tools\python\python.exe --version
   # Should output: Python 3.12.8
   ```

5. **Check agent logs** (with `--debug` flag):
   ```
   "Work Agents.exe" --debug
   ```

   Search logs for:
   ```
   Agent will use bundled tools: python (3.12.8)
   ```

### Runtime Verification

6. **Ask the agent to check Python version**:
   ```
   User: "What Python version do you have?"
   ```

   The agent should report `Python 3.12.8` (not system Python like 2.7.12 or 3.8.8).

7. **Test shell availability**:
   ```
   User: "Run: sh --version"
   ```

   Should execute successfully using bundled `sh.exe` from MinGit.

## Technical Details

### Tool Detection Flow

1. **Main process startup** (`apps/electron/src/main/tool-detection.ts`):
   - Calls `getBundledToolPath('python')` to check for bundled Python
   - Falls back to system PATH if not found

2. **Agent environment setup** (`apps/electron/src/main/agent-env.ts`):
   - Prepends bundled tool directories to PATH
   - Includes `mingit/cmd/` (for git.exe) and `mingit/usr/bin/` (for sh.exe)
   - Passes modified PATH to SDK subprocess

3. **SDK subprocess**:
   - Inherits modified PATH from parent process
   - Commands like `python --version` hit bundled Python first

### File Paths

- **Development:** `apps/electron/resources/tools/python/python.exe`
- **Packaged app:** `resources/app/resources/tools/python/python.exe` (relative to install dir)
- **Runtime detection:** Uses `app.getAppPath()` + `resources/tools/python/python.exe`

### Important Notes

- **`py.exe` launcher:** The Windows Python launcher (`py`) is NOT replaced by bundled Python. If the agent uses `py --version`, it will still show system Python. This is expected and correct.
- **PATH priority:** Bundled tools are prepended to PATH, so `python`, `python3`, `git`, and `sh` commands hit bundled tools first.
- **Shell support:** MinGit includes `sh.exe` (POSIX shell) in `usr/bin/`, which is automatically added to PATH.
- **Idempotent downloads:** The download script skips downloads if tools already exist, making it safe to run multiple times.

## Related Files

- `package.json` (root) — Build script entry point
- `apps/electron/scripts/build-win.ps1` — Windows build script
- `apps/electron/scripts/download-tools.cjs` — Tool download logic
- `apps/electron/scripts/verify-bundled-tools.js` — Verification script
- `apps/electron/resources/tools/README.md` — Tool documentation
- `packages/shared/src/tools/bundled-tools.ts` — Runtime path resolution
- `apps/electron/src/main/tool-detection.ts` — Detection logic
- `apps/electron/src/main/agent-env.ts` — Environment setup

## Testing Checklist

- [ ] Clean build from scratch (delete `resources/tools/`)
- [ ] Run `bun run tools:download` manually
- [ ] Verify tools with `node scripts/verify-bundled-tools.js`
- [ ] Build Windows installer with `bun run electron:dist:win`
- [ ] Install on Windows machine
- [ ] Verify `python.exe` exists in install directory
- [ ] Run app with `--debug` and check logs
- [ ] Ask agent for Python version, confirm 3.12.8
- [ ] Test agent functionality (run Python scripts)
