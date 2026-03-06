# Windows Bundled Tools

This directory contains portable tools bundled with the Windows distribution to ensure agent functionality without requiring system installations.

## Contents

### MinGit 2.44.0
- **Location:** `mingit/cmd/git.exe` (Git command)
- **Additional tools:** `mingit/usr/bin/` (sh.exe, dash.exe, Unix utilities)
- **Purpose:** Portable Git for Windows (minimal distribution) with POSIX shell
- **Size:** ~50MB
- **Source:** https://github.com/git-for-windows/git/releases/tag/v2.44.0.windows.1
- **Usage:** Automatically detected and used by agent sessions on Windows
- **Shell support:** Includes `sh.exe` for running shell scripts

### Python 3.12.8 Embedded
- **Location:** `python/python.exe`
- **Purpose:** Minimal Python runtime for agent tools
- **Size:** ~50MB (base) + ~100MB (with pre-installed packages)
- **Source:** https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip
- **Usage:** Automatically detected and used by agent sessions on Windows
- **pip support:** Automatically installed via `setup-embedded-pip.cjs` during build
  - Modifies `python312._pth` to enable site-packages
  - Downloads and runs `get-pip.py`
  - Installs pip to `python/Scripts/pip.exe`
- **PyPI mirror:** Configured to use Aliyun mirror (https://mirrors.aliyun.com/pypi/simple/)
  - Faster downloads in China
  - Applies to both build-time and runtime pip installations
  - Configuration stored in `python/pip.ini`
- **Pre-installed packages:** Common data processing and utility packages (with locked versions)
  - `openpyxl==3.1.5` - Excel file handling
  - `pandas==3.0.1` - Data analysis (includes numpy, python-dateutil, tzdata)
  - `requests==2.32.5` - HTTP library
  - `beautifulsoup4==4.12.3` - HTML/XML parsing
  - `lxml==5.3.0` - Fast XML/HTML parser
  - `pillow==11.1.0` - Image processing
  - `python-dotenv==1.0.1` - Environment variables
  - `pyyaml==6.0.2` - YAML parsing
  - `jsonschema==4.23.0` - JSON schema validation

## Detection Priority

The app uses a fallback detection system:
1. **Bundled tools** (this directory) — checked first
2. **System tools** — fallback to PATH if bundled tools not found

This ensures the app works out-of-the-box on Windows while still respecting user-installed tools when available.

## Updating Tool Versions

To update tool versions:

1. Edit `apps/electron/scripts/download-tools.cjs`
2. Update the `TOOLS` configuration with new versions and URLs
3. Delete the existing tool directories (`mingit/`, `python/`)
4. Run the download script:
   ```bash
   cd apps/electron
   node scripts/download-tools.cjs
   ```

## Build Integration

Tools are automatically included in Windows builds via `electron-builder.yml`:

```yaml
win:
  extraResources:
    - from: resources/tools
      to: tools
      filter: ["**/*"]
```

The tools directory is copied to the packaged app's resources and accessed at runtime via `app.getAppPath()`.

## Notes

- Tools are only bundled on Windows (not macOS or Linux)
- The download script is idempotent — it skips downloads if tools already exist
- Tools are kept uncompressed (not in ASAR) so executables work properly
- Total directory size: ~100MB
