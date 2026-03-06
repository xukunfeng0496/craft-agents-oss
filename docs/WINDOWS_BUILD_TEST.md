# Windows Build Testing Guide

## Quick Test Steps

### 1. Clean Start (Optional)

```bash
cd apps/electron
rm -rf resources/tools
```

### 2. Verify Download Script

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

### 3. Build Windows Installer

```bash
# From repository root
bun run electron:dist:win
```

Look for this new log line:
```
Downloading bundled tools (Python, MinGit)...
```

### 4. Install and Verify (On Windows)

```powershell
# Check if Python exists in installed app
cd "C:\Users\<你>\AppData\Local\Programs\Work Agents"
dir resources\app\resources\tools\python\python.exe

# Test Python version
.\resources\app\resources\tools\python\python.exe --version
# Should output: Python 3.12.8
```

### 5. Runtime Test

Start the app with debug logging:
```powershell
"Work Agents.exe" --debug
```

Check logs for:
```
Agent will use bundled tools: python (3.12.8)
```

### 6. Agent Test

Ask the agent:
```
What Python version do you have?
```

Should report: **Python 3.12.8** (not 2.7.12 or 3.8.8)

## Expected Behavior

### ✅ Correct (After Fix)

- `python --version` → Python 3.12.8
- `python3 --version` → Python 3.12.8
- Agent uses bundled Python for all operations

### ⚠️ Expected Limitation

- `py --version` → System Python (3.8.8 or whatever is installed)
- This is normal — we don't replace the Windows Python launcher

## Troubleshooting

### If Python is still missing:

1. Check if tools were downloaded:
   ```bash
   ls -lh apps/electron/resources/tools/python/
   ```

2. Check build logs for "Downloading bundled tools" message

3. Verify electron-builder.yml includes extraResources:
   ```yaml
   win:
     extraResources:
       - from: resources/tools
         to: tools
   ```

### If agent still uses system Python:

1. Check main process logs for bundled tool detection
2. Verify PATH injection in agent-env.ts
3. Check if bundled Python exists in install directory

## Files Changed

- `package.json` — Added tools:download to electron:dist:win
- `apps/electron/scripts/build-win.ps1` — Added tool download step
- `docs/WINDOWS_BUILD_FIX.md` — Detailed documentation

## Next Steps

After confirming this works:

1. Test on a clean Windows machine (no Python installed)
2. Verify agent can run Python scripts
3. Check that bundled Python doesn't conflict with system Python
4. Update release notes for next version
