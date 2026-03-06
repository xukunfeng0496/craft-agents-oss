## What's New

### Scheduler (Hooks)
- New **Hooks Settings** page for managing scheduled tasks — create, edit, and delete scheduled prompts with a visual schedule picker
- Support for `workingDirectory` in scheduled tasks, allowing each hook to run in a specific project directory
- Cron-based scheduling with timezone support (powered by croner v9)

### Windows Support
- **Bundled MinGit and Python** on Windows — no manual installation required, the app ships with everything needed to run agents
- Bundled tools take priority over system installations for consistent behavior

### Custom LLM Endpoints
- Fixed 401 errors when connecting to Anthropic-compatible endpoints (e.g. navimaxx proxy) — `api_key_with_endpoint` connections now correctly send `x-api-key` header instead of `Authorization: Bearer`
- Added **CVTE-SECRET** model to preset model list
- Added form validation for required Endpoint and API Key fields

### Other Improvements
- macOS code signing and notarization enabled for packaged builds
- Skill variables overlay now supports runtime refresh when variables are updated
- Fixed i18n path resolution in packaged app
- Fixed double Cmd+Q quit issue on macOS
