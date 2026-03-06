# Bundled Skills

This directory contains pre-installed skills that are automatically copied to the user's global skills directory (`~/.agents/skills/`) on first launch.

## How It Works

1. **Build Time**: Skills in this directory are packaged into the app via `electron-builder.yml`
2. **First Launch**: When the app starts for the first time, `bundled-skills.ts` copies all skills to `~/.agents/skills/`
3. **Subsequent Launches**: The initialization is skipped (tracked via `.bundled-skills-installed` marker file)

## Adding New Skills

To add a new skill to the bundled set:

1. Place the skill directory (with `SKILL.md` and optional `icon.svg`) in this directory
2. Rebuild the app: `bun run electron:build`
3. The skill will be automatically installed on first launch

## Updating Bundled Skills

When you update a skill in this directory:

- **Existing users**: Will NOT receive the update automatically (to preserve user modifications)
- **New users**: Will receive the updated version on first launch

To force update for existing users, they need to:
1. Delete the skill from `~/.agents/skills/{skill-slug}/`
2. Delete the marker file `~/.agents/skills/.bundled-skills-installed`
3. Restart the app

## Directory Structure

```
bundled-skills/
├── agent-browser/
│   ├── SKILL.md
│   └── icon.svg
├── claude-mem/
│   ├── SKILL.md
│   └── icon.svg
├── deep-research/
│   ├── SKILL.md
│   ├── icon.svg
│   ├── scripts/
│   ├── templates/
│   └── reference/
└── ...
```

## Cross-Platform Compatibility

The bundled skills system works identically on:
- **macOS**: Skills copied from `app.asar/resources/bundled-skills/`
- **Windows**: Skills copied from `resources/app/resources/bundled-skills/`
- **Linux**: Skills copied from `resources/app/resources/bundled-skills/`

## Implementation Details

- **Module**: `apps/electron/src/main/bundled-skills.ts`
- **Initialization**: Called in `apps/electron/src/main/index.ts` during `app.whenReady()`
- **Marker File**: `~/.agents/skills/.bundled-skills-installed` (JSON with metadata)
- **Logging**: All operations logged with `[BundledSkills]` prefix

## Troubleshooting

If bundled skills are not being installed:

1. Check the app logs for `[BundledSkills]` messages
2. Verify the bundled skills directory exists in the packaged app
3. Check permissions on `~/.agents/skills/` directory
4. Delete the marker file and restart the app to force reinstall
