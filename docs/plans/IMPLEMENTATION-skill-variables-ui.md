# Implementation Plan: Skill Variables UI

**Status**: 🚧 Ready to Execute
**Created**: 2026-03-01
**Estimated Time**: 6-8 hours
**Priority**: P0 (Highest)

## Quality Gates (Mandatory)

Each step MUST pass these gates before proceeding to the next:

1. **Code Review**: Use `superpowers:code-reviewer` agent to review all changed files against plan and coding standards
2. **Test Design**: Write unit tests BEFORE or alongside implementation (TDD preferred)
3. **Test Execution**: All tests must pass (`bun test`) before marking a step complete
4. **Type Check**: `bun run typecheck:all` must pass after each step
5. **Lint**: `bun run lint` must pass after each step

## Overview

Complete the UI implementation for Skill Variables feature. Backend logic is already done, only UI layer remains.

## Prerequisites

✅ Backend completed:
- `packages/shared/src/credentials/types.ts` - Added `skill_var` credential type
- `packages/shared/src/skills/types.ts` - Added `vars` field to `SkillMetadata`
- `packages/shared/src/skills/vars-storage.ts` - Storage functions
- `packages/shared/src/skills/vars-substitution.ts` - Substitution logic
- `packages/shared/src/skills/storage.ts` - Parse `vars` from frontmatter
- Tests in `packages/shared/src/skills/__tests__/vars.test.ts`

⏳ TODO:
- IPC channels
- UI components

## Implementation Steps

### Step 1: Add IPC Channels (30 min)

#### 1.1 Define IPC channel types

**File**: `apps/electron/src/shared/types.ts`

Add to `IPC_CHANNELS` object:

```typescript
export const IPC_CHANNELS = {
  // ... existing channels

  // Skill Variables
  SKILL_VARS_GET: 'skill-vars:get',
  SKILL_VARS_SET: 'skill-vars:set',
  SKILL_VARS_DELETE: 'skill-vars:delete',
  SKILL_VARS_LIST: 'skill-vars:list',
} as const;
```

#### 1.2 Implement IPC handlers

**File**: `apps/electron/src/main/ipc.ts`

Add handlers:

```typescript
import { getSkillVars, setSkillVars, deleteSkillVar, listSkillVars } from '@work-agent/shared/skills';

// Skill Variables handlers
ipcMain.handle(
  IPC_CHANNELS.SKILL_VARS_GET,
  async (_event, workspaceRoot: string, skillSlug: string) => {
    try {
      return await getSkillVars(workspaceRoot, skillSlug);
    } catch (error) {
      console.error('Failed to get skill vars:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  IPC_CHANNELS.SKILL_VARS_SET,
  async (_event, workspaceRoot: string, skillSlug: string, vars: Record<string, string>) => {
    try {
      await setSkillVars(workspaceRoot, skillSlug, vars);
      return { success: true };
    } catch (error) {
      console.error('Failed to set skill vars:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  IPC_CHANNELS.SKILL_VARS_DELETE,
  async (_event, workspaceRoot: string, skillSlug: string, varName: string) => {
    try {
      await deleteSkillVar(workspaceRoot, skillSlug, varName);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete skill var:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  IPC_CHANNELS.SKILL_VARS_LIST,
  async (_event, workspaceRoot: string, skillSlug: string) => {
    try {
      return await listSkillVars(workspaceRoot, skillSlug);
    } catch (error) {
      console.error('Failed to list skill vars:', error);
      throw error;
    }
  }
);
```

#### 1.3 Expose to renderer

**File**: `apps/electron/src/preload/index.ts`

Add to `ElectronAPI` interface and implementation:

```typescript
export interface ElectronAPI {
  // ... existing methods

  // Skill Variables
  getSkillVars: (workspaceRoot: string, skillSlug: string) => Promise<Record<string, string>>;
  setSkillVars: (workspaceRoot: string, skillSlug: string, vars: Record<string, string>) => Promise<{ success: boolean }>;
  deleteSkillVar: (workspaceRoot: string, skillSlug: string, varName: string) => Promise<{ success: boolean }>;
  listSkillVars: (workspaceRoot: string, skillSlug: string) => Promise<string[]>;
}

// Implementation
contextBridge.exposeInMainWorld('electron', {
  // ... existing methods

  // Skill Variables
  getSkillVars: (workspaceRoot: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILL_VARS_GET, workspaceRoot, skillSlug),
  setSkillVars: (workspaceRoot: string, skillSlug: string, vars: Record<string, string>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILL_VARS_SET, workspaceRoot, skillSlug, vars),
  deleteSkillVar: (workspaceRoot: string, skillSlug: string, varName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILL_VARS_DELETE, workspaceRoot, skillSlug, varName),
  listSkillVars: (workspaceRoot: string, skillSlug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILL_VARS_LIST, workspaceRoot, skillSlug),
});
```

### Step 2: Create UI Components (2-3 hours)

#### 2.1 Create SkillVariablesSection component

**File**: `apps/electron/src/renderer/components/skills/SkillVariablesSection.tsx`

```typescript
import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import type { SkillVariable } from '@work-agent/shared/skills';

interface SkillVariablesSectionProps {
  workspaceRoot: string;
  skillSlug: string;
  variables: SkillVariable[];
}

export function SkillVariablesSection({
  workspaceRoot,
  skillSlug,
  variables
}: SkillVariablesSectionProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load existing values
  useEffect(() => {
    loadValues();
  }, [workspaceRoot, skillSlug]);

  const loadValues = async () => {
    try {
      setLoading(true);
      const existingVars = await window.electron.getSkillVars(workspaceRoot, skillSlug);

      // Initialize with existing values or defaults
      const initialValues: Record<string, string> = {};
      for (const variable of variables) {
        initialValues[variable.name] = existingVars[variable.name] || variable.default || '';
      }

      setValues(initialValues);
    } catch (err) {
      console.error('Failed to load skill variables:', err);
      setError('Failed to load variables');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      // Validate required variables
      const missingRequired = variables
        .filter(v => v.required && !values[v.name])
        .map(v => v.name);

      if (missingRequired.length > 0) {
        setError(`Required variables missing: ${missingRequired.join(', ')}`);
        return;
      }

      // Save
      await window.electron.setSkillVars(workspaceRoot, skillSlug, values);
      setSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save skill variables:', err);
      setError('Failed to save variables');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setSuccess(false);
  };

  const unconfiguredCount = variables.filter(
    v => v.required && !values[v.name]
  ).length;

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading variables...</div>;
  }

  if (variables.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Variables</h3>
        {unconfiguredCount > 0 && (
          <span className="text-sm text-amber-600 dark:text-amber-400">
            ⚠ {unconfiguredCount} 未配置
          </span>
        )}
      </div>

      <div className="space-y-4">
        {variables.map(variable => (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.name}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>

            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}

            <Input
              id={variable.name}
              value={values[variable.name] || ''}
              onChange={(e) => handleChange(variable.name, e.target.value)}
              placeholder={variable.example || variable.default || ''}
              className={
                variable.required && !values[variable.name]
                  ? 'border-amber-500'
                  : ''
              }
            />

            {variable.example && (
              <p className="text-xs text-muted-foreground">
                e.g. {variable.example}
              </p>
            )}
          </div>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription>Variables saved successfully</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  );
}
```

#### 2.2 Update SkillInfoPage

**File**: `apps/electron/src/renderer/pages/SkillInfoPage.tsx`

Find the skill detail rendering section and add the SkillVariablesSection:

```typescript
import { SkillVariablesSection } from '../components/skills/SkillVariablesSection';

// In the component, after skill description:
{skill.metadata.vars && skill.metadata.vars.length > 0 && (
  <div className="mt-6">
    <SkillVariablesSection
      workspaceRoot={workspaceRoot}
      skillSlug={skill.slug}
      variables={skill.metadata.vars}
    />
  </div>
)}
```

### Step 3: Add Badge to Skill List (1 hour)

#### 3.1 Create helper function

**File**: `apps/electron/src/renderer/lib/skill-helpers.ts` (create if not exists)

```typescript
import type { LoadedSkill } from '@work-agent/shared/skills';

export async function hasUnconfiguredVariables(
  workspaceRoot: string,
  skill: LoadedSkill
): Promise<boolean> {
  if (!skill.metadata.vars || skill.metadata.vars.length === 0) {
    return false;
  }

  const requiredVars = skill.metadata.vars.filter(v => v.required);
  if (requiredVars.length === 0) {
    return false;
  }

  try {
    const existingVars = await window.electron.getSkillVars(workspaceRoot, skill.slug);
    return requiredVars.some(v => !existingVars[v.name]);
  } catch {
    return true; // Assume unconfigured if we can't load
  }
}
```

#### 3.2 Update skill list component

Find where skills are rendered in a list (likely in a Skills page or sidebar) and add:

```typescript
import { hasUnconfiguredVariables } from '../lib/skill-helpers';

// In the skill list item:
const [needsConfig, setNeedsConfig] = useState(false);

useEffect(() => {
  hasUnconfiguredVariables(workspaceRoot, skill).then(setNeedsConfig);
}, [workspaceRoot, skill]);

// In the render:
<div className="flex items-center gap-2">
  <span>{skill.metadata.name}</span>
  {needsConfig && (
    <span
      className="text-amber-600 dark:text-amber-400"
      title="需要配置变量才能使用"
    >
      ⚠
    </span>
  )}
</div>
```

### Step 4: Write and Run Tests (1.5 hours)

#### 4.1 Unit Tests for IPC Handlers

**File**: `apps/electron/src/main/__tests__/ipc-skill-vars.test.ts`

Write tests covering:
- `SKILL_VARS_GET` handler returns correct values
- `SKILL_VARS_SET` handler persists values
- `SKILL_VARS_DELETE` handler removes values
- Error handling: invalid workspaceRoot, invalid slug
- Empty vars case

#### 4.2 Unit Tests for UI Helper

**File**: `apps/electron/src/renderer/lib/__tests__/skill-helpers.test.ts`

Write tests covering:
- `hasUnconfiguredVariables` returns `true` when required vars missing
- `hasUnconfiguredVariables` returns `false` when all required vars set
- `hasUnconfiguredVariables` returns `false` for skill with no vars
- `hasUnconfiguredVariables` returns `false` for skill with only optional vars
- `hasUnconfiguredVariables` handles API errors gracefully

#### 4.3 Run All Tests

```bash
# Run full test suite
bun test

# Type check
bun run typecheck:all

# Lint
bun run lint
```

All tests MUST pass before proceeding.

### Step 5: Code Review (30 min)

Use `superpowers:code-reviewer` agent to review ALL changed files:

**Review checklist**:
- [ ] IPC channel naming follows existing conventions (`skills:vars:*`)
- [ ] IPC handlers match existing patterns in `ipc.ts`
- [ ] Preload API matches existing patterns in `preload/index.ts`
- [ ] Component follows existing React patterns (hooks, error handling)
- [ ] No security issues (XSS, injection)
- [ ] No hardcoded strings that should be i18n
- [ ] Error messages are user-friendly
- [ ] Loading/saving states handled correctly
- [ ] No memory leaks (cleanup in useEffect)
- [ ] Consistent styling with existing components

### Step 6: Manual Testing (1 hour)

#### 6.1 Manual testing checklist

- [ ] Create a test skill with variables in `~/.agents/skills/test-skill/SKILL.md`:
  ```yaml
  ---
  name: Test Skill
  description: Test skill with variables
  vars:
    - name: TEST_URL
      description: Test URL
      required: true
      example: "https://example.com"
    - name: TEST_KEY
      description: Test API Key
      required: true
    - name: TEST_OPTIONAL
      description: Optional value
      required: false
      default: "default-value"
  ---

  Test content with {{TEST_URL}} and {{TEST_KEY}}.
  ```

- [ ] Start the app: `bun run electron:dev`
- [ ] Navigate to Skills page
- [ ] Verify ⚠ badge shows for test-skill
- [ ] Click on test-skill to open detail page
- [ ] Verify Variables section appears
- [ ] Verify required fields are marked with *
- [ ] Try to save without filling required fields → should show error
- [ ] Fill in all required fields and save → should succeed
- [ ] Reload the page → values should persist
- [ ] Verify ⚠ badge disappears from skill list
- [ ] Verify skill can be invoked with variables substituted

#### 6.2 Edge cases to test

- [ ] Skill with no variables → Variables section should not appear
- [ ] Skill with only optional variables → Should work without configuration
- [ ] Very long variable values → Should handle gracefully
- [ ] Special characters in values → Should be properly escaped
- [ ] Multiple skills with same variable names → Should be isolated

### Step 7: Documentation (30 min)

#### 5.1 Update user documentation

Create or update `docs/user-guide/skills-variables.md`:

```markdown
# Skill Variables

Skills can declare variables that need to be configured before use.

## Configuring Variables

1. Navigate to Skills page
2. Click on a skill that shows ⚠ badge
3. Scroll to Variables section
4. Fill in required values (marked with *)
5. Click Save

## Variable Types

- **Required**: Must be configured before skill can be used
- **Optional**: Has a default value, can be overridden

## Security

All variable values are encrypted and stored locally in `~/.workagent/credentials.enc`.
```

#### 5.2 Update CHANGELOG

Add to `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- Skill Variables UI: Configure skill-specific variables through UI
- Variable validation and persistence
- Visual indicators for skills requiring configuration
```

## Acceptance Criteria

- [ ] IPC channels implemented and working
- [ ] Variables section appears in skill detail page
- [ ] Can save and load variable values
- [ ] Required variables are validated
- [ ] Badge appears on skills with unconfigured variables
- [ ] Values persist across app restarts
- [ ] **Unit tests written and passing** (`bun test`)
- [ ] **Type check passing** (`bun run typecheck:all`)
- [ ] **Lint passing** (`bun run lint`)
- [ ] **Code review completed** (via `superpowers:code-reviewer`)
- [ ] All manual tests pass
- [ ] Documentation updated

## Rollback Plan

If issues are found:
1. Revert UI changes (IPC handlers can stay as they don't affect existing functionality)
2. Backend logic is already tested and stable
3. No database migrations needed

## Notes

- Backend is already complete and tested
- This is purely UI work
- No breaking changes to existing functionality
- Variables are stored using existing CredentialManager (encrypted)

## Related Files

- Design doc: `docs/plans/2026-02-26-skill-variables-design.md`
- Backend implementation: `packages/shared/src/skills/vars-*.ts`
- Tests: `packages/shared/src/skills/__tests__/vars.test.ts`
