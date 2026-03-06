# Bundled Skills

This directory contains pre-installed skills that are automatically copied to each workspace's skills directory when a workspace is created.

## How It Works

1. **Build Time**: Skills in this directory are packaged into the app via `electron-builder.yml`
2. **Workspace Creation**: When a new workspace is created, `bundled-skills.ts` copies all skills to `{workspace}/skills/`
3. **App Startup**: On app startup, checks all existing workspaces and installs bundled skills if:
   - The workspace has no skills directory
   - The workspace has fewer than 3 skills (likely empty or incomplete)
4. **Existing Workspaces**: Skills are only copied once; existing skills are preserved

## Cross-Platform Support

Works identically on:
- **macOS**: `~/.workagent/workspaces/my-workspace/skills/`
- **Windows**: `%USERPROFILE%\.workagent\workspaces\my-workspace\skills\`
- **Linux**: `~/.workagent/workspaces/my-workspace/skills/`

## Adding New Skills

To add a new skill to the bundled set:

1. Place the skill directory (with `SKILL.md` and optional `icon.svg`) in this directory
2. Rebuild the app: `bun run electron:build`
3. The skill will be automatically installed when new workspaces are created

## Updating Bundled Skills

When you update a skill in this directory:

- **New workspaces**: Will receive the updated version
- **Existing workspaces with no skills**: Will receive bundled skills on next app startup
- **Existing workspaces with skills**: Will NOT receive updates automatically (to preserve user modifications)

To update skills in an existing workspace with skills, users need to manually delete the skill directory and restart the app.

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

## Implementation Details

- **Module**: `apps/electron/src/main/bundled-skills.ts`
- **Initialization**: Called when creating a workspace in:
  - `apps/electron/src/main/index.ts` (default workspace creation)
  - `apps/electron/src/main/ipc.ts` (user-created workspaces)
- **Logging**: All operations logged with `[BundledSkills]` prefix

## Troubleshooting

If bundled skills are not being installed:

1. Check the app logs for `[BundledSkills]` messages
2. Verify the bundled skills directory exists in the packaged app
3. Check permissions on the workspace skills directory
4. Try creating a new workspace to test the installation
