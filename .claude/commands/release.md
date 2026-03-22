# Release a new version

Prepare and publish a new release for Work Agents.

## Arguments

- `$ARGUMENTS` — the new version number (e.g. `0.8.0`). If not provided, ask the user.

## Steps

### 1. Validate version

- Parse `$ARGUMENTS` as a semver version (X.Y.Z)
- Read current version from `apps/electron/package.json`
- Confirm the new version is higher than the current version
- If invalid, stop and ask the user

### 2. Generate release notes

- Run `git log --oneline <last-version-bump-commit>..HEAD --no-merges` to list all changes since the last release
- Categorize commits into: 新功能 (feat), 修复 (fix), 改进 (refactor/perf/chore)
- Write `apps/electron/RELEASE_NOTES.md` in Chinese, following this exact format:

```markdown
## vX.Y.Z 更新内容

### 新功能
- **功能名称**：一句话描述

### 修复
- **问题名称**：一句话描述

### 改进
- **改进名称**：一句话描述
```

- Omit empty sections
- Show the generated notes to the user for confirmation before proceeding

### 3. Bump version

Update the `"version"` field in all 4 `package.json` files to the new version:

1. `package.json` (root)
2. `apps/electron/package.json` (CI reads this as the authoritative version)
3. `packages/shared/package.json`
4. `packages/core/package.json`

### 4. Commit

```
git add package.json apps/electron/package.json packages/shared/package.json packages/core/package.json apps/electron/RELEASE_NOTES.md
git commit -m "chore: bump version to X.Y.Z"
```

### 5. Push

Push to both remotes (ask user which to push if unsure):

```bash
git push origin cvte/main    # GitLab — triggers CI build
git push github cvte/main    # GitHub — CI creates release + tag vX.Y.Z
```

### 6. Post-push summary

Print a summary:

```
Version:  vX.Y.Z
Commit:   <sha>
Remotes:  origin (GitLab), github (GitHub)

CI will automatically:
  - Build macOS (arm64 + x64), Windows (x64), Linux (x64)
  - Create GitHub Release with tag vX.Y.Z
  - Upload artifacts: Work-Agent-X.Y.Z-{platform}.{ext}

After CI completes, optionally upload to fast-update-server:
  FAST_UPDATE_TOKEN=xxx AUTO_UPDATE_SERVER_URL=https://... bun run fast-update:upload
```

## Important notes

- The GitHub release tag (`vX.Y.Z`) is created automatically by CI via `softprops/action-gh-release`. No manual `git tag` needed.
- CI reads the version from `apps/electron/package.json` — this is the source of truth.
- CI reads release notes from `apps/electron/RELEASE_NOTES.md` and prepends an install table.
- Fast-update-server upload (`bun run fast-update:upload`) is a separate manual step after CI completes.
