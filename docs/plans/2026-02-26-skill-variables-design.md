# Skill Variables Design

## Problem

Skills often contain hardcoded user-specific information (API endpoints, usernames, org names, etc.), making them non-portable. Users can't share skills without exposing or stripping their personal config.

## Solution

Skills declare the variables they need in frontmatter. Users fill in values via UI. Skill content uses `{{VAR_NAME}}` placeholders that get substituted at load time.

## Data Model

### Skill Frontmatter

```yaml
---
name: jiandaoyun
description: 简道云私有化部署数据读写
vars:
  - name: JDY_BASE_URL
    description: 简道云私有化部署地址
    required: true
    example: "https://jdy.cvte.com"
  - name: JDY_API_KEY
    description: API 密钥
    required: true
  - name: JDY_APP_ID
    description: 应用 ID
    required: false
    default: "default"
---
```

### Skill Content

```markdown
调用接口时使用 {{JDY_BASE_URL}}/api/v1/...
认证头：Authorization: Bearer {{JDY_API_KEY}}
```

### Storage

- Skill variable values: `~/.workagent/workspaces/{id}/skill-vars/{slug}.json`
- Format: `{ "JDY_BASE_URL": "https://jdy.cvte.com", "JDY_API_KEY": "..." }`

### Resolution

- Substitution happens at skill load time
- Unset required variables: preserved as `{{VAR_NAME}}` and flagged in UI
- Unset optional variables with defaults: default value substituted

## UI

### Skill Detail Page — Variables Section

```
Variables                      ⚠ 2 未配置
─────────────────────────────────────────
JDY_BASE_URL *
简道云私有化部署地址
[_________________________________]
e.g. https://jdy.cvte.com

JDY_API_KEY  *
API 密钥
[_________________________________]

JDY_APP_ID
应用 ID（可选，默认 "default"）
[default                        ]

[Save]
```

### Skill List

- Skills with unset required vars show `⚠` badge
- Hover tooltip: "需要配置变量才能使用"

### Agent Fallback

If a skill is invoked with unset required variables, the agent response includes:
> skill `jiandaoyun` 需要配置变量 `JDY_BASE_URL`，请前往 Settings → Skills 配置。

## Implementation Plan

### Files Changed ✅

| File | Change | Status |
|------|--------|--------|
| `packages/shared/src/credentials/types.ts` | Added `skill_var` credential type | ✅ Done |
| `packages/shared/src/skills/types.ts` | Added `vars` field to `SkillMetadata` | ✅ Done |
| `packages/shared/src/skills/vars-storage.ts` | New: `getSkillVars` / `setSkillVars` | ✅ Done |
| `packages/shared/src/skills/vars-substitution.ts` | New: `substituteSkillVars` logic | ✅ Done |
| `packages/shared/src/skills/storage.ts` | Parse `vars` from frontmatter | ✅ Done |
| `packages/shared/src/skills/index.ts` | Export new functions | ✅ Done |
| `apps/electron/src/shared/types.ts` | Add `SKILL_VARS_GET` / `SKILL_VARS_SET` IPC channels | ⏳ TODO |
| `apps/electron/src/main/ipc.ts` | Implement IPC handlers | ⏳ TODO |
| `apps/electron/src/preload/index.ts` | Expose to renderer | ⏳ TODO |
| Skill detail UI component | Add Variables section | ⏳ TODO |

### Implementation Notes

**Storage Architecture**: Variables are stored using the existing encrypted credential system (`CredentialManager`) with the format `skill_var::{workspaceId}::{skillSlug}::{varName}`. This provides:
- AES-256-GCM encryption for all variables (sensitive and non-sensitive)
- Unified credential management API
- No additional storage infrastructure needed

**Tests**: Added comprehensive tests in `packages/shared/src/skills/__tests__/vars.test.ts` covering:
- Variable storage and retrieval
- Placeholder substitution
- Default value handling
- Required variable detection

**Example**: Created example skill at `docs/examples/skill-with-variables/SKILL.md` demonstrating variable usage.

### Out of Scope (for now)

- Workspace-level shared variables
- Secret/encrypted variable storage
- Skill export/import bundles
- Variable validation beyond required/optional
