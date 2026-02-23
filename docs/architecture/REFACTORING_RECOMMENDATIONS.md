# Large File Refactoring Recommendations

This document summarizes recommended file splits for maintainability. These are **P2 priority** and should be scheduled for future refactoring cycles.

---

## 1. `packages/shared/src/config/storage.ts` (2015 lines, 88 functions)

**Current responsibilities:**
- Config loading/saving (`loadStoredConfig`, `saveConfig`)
- App settings getters/setters (language, notifications, input settings)
- Workspace management (CRUD, switching)
- Conversation/plan persistence
- Session drafts
- Theme management (app + preset themes)
- LLM connection management
- Migration functions (legacy configs)
- Tool icons

**Recommended split:**

| New File | Functions to Move | Lines (est.) |
|----------|-------------------|--------------|
| `config-core.ts` | `loadStoredConfig`, `saveConfig`, `ensureConfigDir`, `clearAllConfig` | ~100 |
| `app-settings.ts` | All `get*/set*` for app-level settings (language, notifications, etc.) | ~200 |
| `workspace-storage.ts` | `getWorkspaces`, `addWorkspace`, `removeWorkspace`, `switchWorkspaceAtomic` | ~300 |
| `conversation-storage.ts` | `saveWorkspaceConversation`, `loadWorkspaceConversation`, `clearWorkspaceConversation` | ~100 |
| `plan-storage.ts` | `saveWorkspacePlan`, `loadWorkspacePlan`, `clearWorkspacePlan` | ~50 |
| `drafts-storage.ts` | All draft-related functions | ~80 |
| `theme-storage.ts` | `loadAppTheme`, `saveAppTheme`, `loadPresetThemes`, `ensurePresetThemes` | ~300 |
| `llm-connections-storage.ts` | All `*LlmConnection` functions | ~250 |
| `config-migrations.ts` | All `migrate*` functions | ~400 |
| `tool-icons.ts` | `getToolIconsDir`, `ensureToolIcons` | ~30 |

---

## 2. `packages/shared/src/config/validators.ts` (1987 lines)

**Current responsibilities:**
- Zod schemas for all config types
- Validation functions for config.json, preferences.json
- Source validation
- Permissions validation
- Tool icons validation
- Auto-fix capabilities

**Recommended split:**

| New File | Contents | Lines (est.) |
|----------|----------|--------------|
| `schemas/config.ts` | `StoredConfigSchema`, `WorkspaceSchema`, `LlmConnectionSchema` | ~200 |
| `schemas/preferences.ts` | `UserPreferencesSchema`, location schemas | ~150 |
| `schemas/source.ts` | Source-related schemas | ~200 |
| `schemas/permissions.ts` | Permissions rule schemas | ~200 |
| `schemas/tool-icons.ts` | Tool icons schema | ~100 |
| `validate/config.ts` | `validateConfig` implementation | ~100 |
| `validate/preferences.ts` | `validatePreferences` implementation | ~100 |
| `validate/source.ts` | Source validation functions | ~200 |
| `validate/permissions.ts` | Permissions validation | ~200 |
| `validate/fixes.ts` | Auto-fix implementations | ~300 |

---

## 3. `packages/shared/src/config/watcher.ts` (1083 lines)

**Current responsibilities:**
- File watching setup
- Callback registration
- Debounced change handling
- Workspace-specific watchers
- Source/skill/status watchers

**Recommended split:**

| New File | Contents | Lines (est.) |
|----------|----------|--------------|
| `watcher/types.ts` | `ConfigWatcherCallbacks`, `UserPreferences` interfaces | ~100 |
| `watcher/core.ts` | `ConfigWatcher` class, setup/teardown | ~300 |
| `watcher/debounce.ts` | Debounce utilities | ~50 |
| `watcher/sources.ts` | Source change handling | ~150 |
| `watcher/skills.ts` | Skill change handling | ~150 |
| `watcher/statuses.ts` | Status change handling | ~100 |
| `watcher/themes.ts` | Theme change handling | ~100 |

---

## 4. `packages/shared/src/auth/oauth.ts` (788 lines)

**Current responsibilities:**
- `CraftOAuth` class (main OAuth flow)
- PKCE generation
- OAuth metadata discovery
- Protected resource metadata
- URL safety validation
- Token refresh logic

**Recommended split:**

| New File | Contents | Lines (est.) |
|----------|----------|--------------|
| `oauth/types.ts` | `OAuthConfig`, `OAuthTokens`, `OAuthCallbacks` interfaces | ~50 |
| `oauth/pkce.ts` | `generatePKCE`, `generateState` | ~50 |
| `oauth/craft.ts` | `CraftOAuth` class | ~400 |
| `oauth/discovery.ts` | `discoverOAuthMetadata`, `tryFetchAuthServerMetadata`, metadata types | ~200 |
| `oauth/url-safety.ts` | `isUrlSafeToFetch`, URL validation | ~80 |

---

## 5. `packages/shared/src/network-interceptor.ts` (726 lines)

**Current responsibilities:**
- Fetch interception
- Metadata injection/stripping
- API error capture
- Request logging (cURL format)
- Fast mode detection
- Beta header management

**Recommended split:**

| New File | Contents | Lines (est.) |
|----------|----------|--------------|
| `interceptor/core.ts` | `interceptedFetch`, main interception logic | ~200 |
| `interceptor/metadata.ts` | `addMetadataToAllTools`, `injectMetadataIntoHistory`, stripping | ~200 |
| `interceptor/errors.ts` | `shouldCaptureApiErrors`, error capture logic | ~100 |
| `interceptor/logging.ts` | `toCurl`, `logResponse`, logging utilities | ~150 |
| `interceptor/headers.ts` | `appendBetaHeader`, header utilities | ~50 |
| `interceptor/types.ts` | Type exports | ~30 |

---

## 6. `apps/electron/src/main/sessions.ts` (5931 lines)

**Current responsibilities:**
- `SessionManager` class (main session lifecycle)
- Agent configuration building
- MCP server setup from sources
- Codex/Copilot bridge configuration
- Message transformation (stored ↔ SDK)
- Credential cache management
- Permission mode management
- Tool display metadata
- File utilities (secure write, bundled bun path)

**Recommended split:**

| New File | Contents | Lines (est.) |
|----------|----------|--------------|
| `sessions/types.ts` | Session-related types, interfaces | ~200 |
| `sessions/manager.ts` | `SessionManager` class (core lifecycle) | ~2000 |
| `sessions/agent-config.ts` | Agent configuration building, flags | ~300 |
| `sessions/mcp-servers.ts` | `buildServersFromSources`, MCP setup | ~300 |
| `sessions/bridge-config.ts` | Codex/Copilot bridge setup functions | ~300 |
| `sessions/message-transform.ts` | `messageToStored`, `storedToMessage` | ~200 |
| `sessions/credentials.ts` | Credential cache management | ~200 |
| `sessions/permissions.ts` | Permission mode handling | ~200 |
| `sessions/tools.ts` | `resolveToolDisplayMeta`, tool utilities | ~300 |
| `sessions/file-utils.ts` | `writeFileSecure`, `getBundledBunPath` | ~100 |

---

## Implementation Order

Recommended sequence when resources allow:

1. **sessions.ts** - Highest impact (nearly 6000 lines, frequently modified)
2. **storage.ts** - Core config, many dependencies
3. **validators.ts** - Can be done incrementally by schema type
4. **watcher.ts** - Independent, lower risk
5. **oauth.ts** - Stable, lower priority
6. **network-interceptor.ts** - Stable, lowest priority

---

## Dependencies Between Files

```
storage.ts ─────────────────────────────────────────────────────────┐
    │                                                               │
    ├── validators.ts (imports schemas)                             │
    └── watcher.ts (imports types, validators)                      │
                                                                    │
sessions.ts ────────────────────────────────────────────────────────┤
    │                                                               │
    └── (imports from config/, sources/, credentials/)              │
                                                                    │
oauth.ts ───────────────────────────────────────────────────────────┤
    │                                                               │
    └── (relatively isolated)                                       │
                                                                    │
network-interceptor.ts ─────────────────────────────────────────────┘
    │
    └── (imports from interceptor-common.ts, already modular)
```

---

## Metrics

| File | Current Lines | Target Lines After Split | Max File Size |
|------|---------------|-------------------------|---------------|
| sessions.ts | 5931 | ~500 per file | 1000 |
| storage.ts | 2015 | ~200 per file | 500 |
| validators.ts | 1987 | ~200 per file | 500 |
| watcher.ts | 1083 | ~200 per file | 400 |
| oauth.ts | 788 | ~200 per file | 500 |
| network-interceptor.ts | 726 | ~200 per file | 400 |

---

*Document created: 2026-02-23*
*Last updated: 2026-02-23*
