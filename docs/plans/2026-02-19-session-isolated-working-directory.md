# Session Isolated Working Directory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a workspace settings toggle (default: ON) that gives each session its own subdirectory under the workspace working directory, preventing file pollution between sessions.

**Architecture:** Add `isolateSessionDirectory` boolean to `WorkspaceConfig.defaults` and `WorkspaceSettings`. When ON and a `workingDirectory` is configured, session creation computes `{workingDirectory}/{sessionId}/`, creates it on disk, and uses it as the session's `workingDirectory`. The toggle is surfaced in the Advanced section of Workspace Settings alongside the existing working directory row.

**Tech Stack:** TypeScript, Electron IPC, React, i18next (en + zh-CN), Bun test

---

### Task 1: Add type field to WorkspaceConfig

**Files:**
- Modify: `packages/shared/src/workspaces/types.ts:41-51`

**Step 1: Add the field**

In `WorkspaceConfig.defaults`, add after `workingDirectory?: string;`:

```typescript
/** When true (default), each session gets its own subdirectory under workingDirectory */
isolateSessionDirectory?: boolean;
```

**Step 2: Verify type check passes**

```bash
cd packages/shared && bun run tsc --noEmit
```
Expected: no errors

**Step 3: Commit**

```bash
git add packages/shared/src/workspaces/types.ts
git commit -m "feat: add isolateSessionDirectory to WorkspaceConfig defaults"
```

---

### Task 2: Add field to WorkspaceSettings IPC type

**Files:**
- Modify: `apps/electron/src/shared/types.ts:1254-1269`

**Step 1: Add the field**

In `WorkspaceSettings`, add after `workingDirectory?: string`:

```typescript
/** When true (default), each session gets its own subdirectory under workingDirectory */
isolateSessionDirectory?: boolean
```

**Step 2: Verify**

```bash
bun run typecheck:all
```
Expected: no errors

**Step 3: Commit**

```bash
git add apps/electron/src/shared/types.ts
git commit -m "feat: add isolateSessionDirectory to WorkspaceSettings type"
```

---

### Task 3: Wire up IPC get/update handlers

**Files:**
- Modify: `apps/electron/src/main/ipc.ts:1966-2018`

**Step 1: Update `getWorkspaceSettings` return value**

In the return object (around line 1966), add after `workingDirectory`:

```typescript
isolateSessionDirectory: config?.defaults?.isolateSessionDirectory ?? true,
```

**Step 2: Add to validKeys and handle in update**

In `updateWorkspaceSetting` handler:
- Add `'isolateSessionDirectory'` to the `validKeys` array (line ~1985)
- The key goes into `config.defaults` via the existing generic `else` branch — no special case needed

**Step 3: Verify**

```bash
bun run typecheck:all
```
Expected: no errors

**Step 4: Commit**

```bash
git add apps/electron/src/main/ipc.ts
git commit -m "feat: wire isolateSessionDirectory in IPC get/update handlers"
```

---

### Task 4: Apply isolation logic in session creation

**Files:**
- Modify: `apps/electron/src/main/sessions.ts:2147-2168`

**Step 1: Read the setting and apply isolation**

After the `resolvedWorkingDir` block (around line 2158) and before `createStoredSession`, add:

```typescript
// Read isolation setting (default: true)
const isolateSessionDir = wsConfig?.defaults?.isolateSessionDirectory ?? true
```

After `createStoredSession` returns `storedSession` (around line 2168), add:

```typescript
// If isolation is enabled and a working directory is configured, create a
// session-specific subdirectory and update the session's workingDirectory.
if (isolateSessionDir && resolvedWorkingDir) {
  const isolatedDir = join(resolvedWorkingDir, storedSession.id)
  await mkdir(isolatedDir, { recursive: true })
  await updateSessionMetadata(workspaceRootPath, storedSession.id, {
    workingDirectory: isolatedDir,
  })
  resolvedWorkingDir = isolatedDir
}
```

Note: `join` and `mkdir` are already imported at the top of `sessions.ts` (lines 3 and 5).

**Step 2: Verify**

```bash
bun run typecheck:all
```
Expected: no errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/sessions.ts
git commit -m "feat: create isolated session subdirectory when isolateSessionDirectory is enabled"
```

---

### Task 5: Add i18n strings

**Files:**
- Modify: `packages/shared/locales/en/settings.json:428-437`
- Modify: `packages/shared/locales/zh-CN/settings.json:427-436`

**Step 1: Add English strings**

In `en/settings.json`, inside `"advanced"` object after `"localMcp"`:

```json
"isolateSessionDirectory": {
  "label": "Isolate Session Directories",
  "description": "Give each session its own subdirectory under the working directory"
}
```

**Step 2: Add Chinese strings**

In `zh-CN/settings.json`, inside `"advanced"` object after `"localMcp"`:

```json
"isolateSessionDirectory": {
  "label": "隔离会话目录",
  "description": "在工作目录下为每个会话分配独立的子目录"
}
```

**Step 3: Commit**

```bash
git add packages/shared/locales/en/settings.json packages/shared/locales/zh-CN/settings.json
git commit -m "feat: add i18n strings for isolateSessionDirectory setting"
```

---

### Task 6: Add label keys to workspace-settings-labels.ts

**Files:**
- Modify: `apps/electron/src/renderer/pages/settings/workspace-settings-labels.ts:47-49`

**Step 1: Add label entries**

After `localMcpDescription` line, add:

```typescript
isolateSessionDirLabel: t('settings:workspace.advanced.isolateSessionDirectory.label'),
isolateSessionDirDescription: t('settings:workspace.advanced.isolateSessionDirectory.description'),
```

**Step 2: Commit**

```bash
git add apps/electron/src/renderer/pages/settings/workspace-settings-labels.ts
git commit -m "feat: add isolateSessionDirectory label keys"
```

---

### Task 7: Add toggle to WorkspaceSettingsPage

**Files:**
- Modify: `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`

**Step 1: Add state**

Near the `localMcpEnabled` state (line ~67), add:

```typescript
const [isolateSessionDir, setIsolateSessionDir] = useState(true)
```

**Step 2: Load setting from workspace**

In the settings load effect (near line ~94 where `localMcpEnabled` is set), add:

```typescript
setIsolateSessionDir(settings.isolateSessionDirectory ?? true)
```

**Step 3: Add handler**

After `handleLocalMcpEnabledChange` (around line ~276), add:

```typescript
const handleIsolateSessionDirChange = useCallback(
  async (enabled: boolean) => {
    setIsolateSessionDir(enabled)
    await updateWorkspaceSetting('isolateSessionDirectory', enabled)
  },
  [updateWorkspaceSetting]
)
```

**Step 4: Add toggle to UI**

In the Advanced `SettingsCard` (after the `localMcpEnabled` toggle, around line ~536), add:

```tsx
<SettingsToggle
  label={labels.isolateSessionDirLabel}
  description={labels.isolateSessionDirDescription}
  checked={isolateSessionDir}
  onCheckedChange={handleIsolateSessionDirChange}
/>
```

**Step 5: Verify type check and run tests**

```bash
bun run typecheck:all
bun test
```
Expected: no errors, tests pass

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx
git commit -m "feat: add isolate session directory toggle to workspace settings UI"
```

---

### Task 8: Manual smoke test

1. Run `bun run electron:dev`
2. Open Workspace Settings → Advanced section
3. Verify "Isolate Session Directories" toggle appears, defaulting to ON
4. With a working directory configured, create two sessions
5. Verify each session's working directory is `{workingDirectory}/{sessionId}/` and the directories exist on disk
6. Toggle OFF, create a new session — verify it uses the shared `workingDirectory`
7. Toggle ON with no working directory set — verify new sessions are unaffected (no isolation applied)
