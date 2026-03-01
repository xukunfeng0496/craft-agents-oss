# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run electron:dev          # Hot reload Electron app
bun run electron:dev:terminal # Dev with terminal output
bun run viewer:dev            # Viewer app development

# Build
bun run electron:build        # Build all Electron components
bun run electron:dist:mac     # Build macOS DMG (arm64 + x64)
bun run electron:dist:win     # Build Windows installer
bun run electron:dist:linux   # Build Linux AppImage

# Type checking
bun run typecheck             # Type check shared package
bun run typecheck:all         # Type check all packages
cd packages/shared && bun run tsc --noEmit  # Direct tsc

# Linting
bun run lint                  # Lint all packages
bun run lint:electron         # Lint Electron app only
bun run lint:shared           # Lint shared package only

# Testing
bun test                      # Run tests

# Utilities
bun run electron:clean        # Clean build artifacts
bun run fresh-start           # Reset config (dev only)
bun run print:system-prompt   # Print agent system prompt
```

## Architecture

This is a **Bun monorepo** for a Claude Code-like AI agent desktop app (Electron + React).

### Packages

| Package | Purpose |
|---------|---------|
| `apps/electron` | Desktop app — Electron main process + React renderer |
| `apps/viewer` | Web viewer for session transcripts |
| `packages/core` | Shared TypeScript types only (`@work-agent/core`) |
| `packages/shared` | Business logic — agent, auth, config, MCP (`@work-agent/shared`) |
| `packages/bridge-mcp-server` | MCP bridge for Codex sessions (subprocess) |
| `packages/session-mcp-server` | Session management MCP server |
| `packages/session-tools-core` | Session tool implementations |
| `packages/ui` | Shared UI components |

### Electron App Structure

**Main process** (`apps/electron/src/main/`):
- `sessions.ts` — Session lifecycle, agent startup, Codex credential caching
- `ipc.ts` — All IPC handlers between main and renderer
- `window-manager.ts` — Multi-window management
- `deep-link.ts` — `workagents://` URL scheme handling

**Renderer** (`apps/electron/src/renderer/`):
- React 18 + Jotai (state) + Tailwind CSS v4 + shadcn/ui
- Entry: `main.tsx` → `App.tsx`

**Build pipeline:** esbuild for main/preload, Vite for renderer.

### Agent Backends

All agents implement a common `AgentBackend` interface in `packages/shared/src/agent/`:
- `craft-agent.ts` — Claude Agent SDK wrapper (primary)
- `codex-agent.ts` — OpenAI/Codex agent
- `copilot-agent.ts` — GitHub Copilot agent
- `base-agent.ts` — Abstract base class

### Permission Modes

Three modes per session (no global state):

| Mode | Display | Behavior |
|------|---------|---------|
| `'safe'` | Explore | Read-only, blocks writes |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all |

SHIFT+TAB cycles through modes. Customizable rules in `permissions.json` at workspace and source levels.

### Data Storage

All data lives under `~/.workagent/`:
- `config.json` — App + workspace config
- `credentials.enc` — AES-256-GCM encrypted credentials
- `workspaces/{id}/sessions/` — Session persistence
- `workspaces/{id}/sources/{slug}/` — Source configs + credential cache
- `workspaces/{id}/theme.json` — Workspace theme overrides
- `workspaces/{id}/permissions.json` — Workspace permission rules

### Key Design Notes

- **Sessions are the primary isolation boundary**, not workspaces. Each session maps 1:1 with an SDK session.
- **Craft OAuth** (`craft_oauth::global`) is ONLY for the Craft API — never for MCP server auth.
- **Bridge MCP Server credential flow:** Main process decrypts credentials and writes to `.credential-cache.json` (0600 permissions); the bridge subprocess reads this file on each request (passive refresh model).
- **Theme system** cascades: app → workspace (last wins). 6-color system: `background`, `foreground`, `accent`, `info`, `success`, `destructive`.
- **Sources** are external data connections (MCP servers, APIs, local filesystems, Gmail). Types: `mcp`, `api`, `local`, `gmail`.

### Windows Bundled Tools

On Windows, the app bundles MinGit and Python to ensure agent functionality without requiring system installations.

**Tool locations (in packaged app):**
- MinGit 2.44.0: `resources/tools/mingit/cmd/git.exe`
- Python 3.12.8: `resources/tools/python/python.exe`

**Detection priority:**
1. Bundled tools (Windows only) — checked first via `getBundledToolPath()`
2. System tools — fallback via PATH lookup

**Build process:**
```bash
# Download tools (idempotent, skips if exists)
cd apps/electron && node scripts/download-tools.cjs

# Tools are automatically included in Windows builds via electron-builder.yml
bun run electron:dist:win
```

**Implementation:**
- `packages/shared/src/tools/bundled-tools.ts` — Path resolution for bundled tools
- `apps/electron/src/main/tool-detection.ts` — Detection logic with bundled → system priority
- `apps/electron/src/main/agent-env.ts` — Injects tool paths into agent environment
- `apps/electron/scripts/download-tools.cjs` — Downloads and extracts tools

**Maintenance:**
- Tools are downloaded once and cached in `apps/electron/resources/tools/`
- To update versions: modify `TOOLS` config in `download-tools.cjs` and re-run script
- Total size: ~100MB (MinGit ~50MB, Python ~50MB)
- See `apps/electron/resources/tools/README.md` for detailed tool information

### Package Imports

```typescript
import { CraftAgent } from '@work-agent/shared/agent';
import { loadStoredConfig } from '@work-agent/shared/config';
import { getCredentialManager } from '@work-agent/shared/credentials';
import { CraftMcpClient } from '@work-agent/shared/mcp';
import type { Session, Message, AgentEvent } from '@work-agent/core';
```

See `packages/shared/CLAUDE.md` and `packages/core/CLAUDE.md` for detailed package-level docs.

## Common Task Navigation

### Adding a New IPC Handler

Three files, in order:
1. `apps/electron/src/shared/types.ts` — add channel to `IPC_CHANNELS` object
2. `apps/electron/src/main/ipc.ts` — add `ipcMain.handle(IPC_CHANNELS.X, ...)` handler
3. `apps/electron/src/preload/index.ts` — expose in `ElectronAPI` via `ipcRenderer.invoke()`

Renderer then calls: `window.electron.yourFunction()`

### Adding a New Setting

1. `packages/shared/src/config/storage.ts` — add field to `StoredConfig` interface
2. `packages/shared/src/config/index.ts` (or sub-file like `llm-connections.ts`) — add getter/setter
3. `apps/electron/src/main/ipc.ts` — add IPC handler
4. `apps/electron/src/preload/index.ts` — expose in preload
5. Settings page (see below) — add UI

**Settings pages by area:**
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — LLM/AI settings
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` — App-level settings
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx` — Workspace settings
- `apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx` — Theme/appearance
- `apps/electron/src/renderer/pages/settings/PermissionsSettingsPage.tsx` — Permission rules

### Modifying Session Lifecycle

- `apps/electron/src/main/sessions.ts` — `SessionManager` class: creation, deletion, message sending, agent init
- `packages/shared/src/sessions/` — Session persistence (CRUD, metadata, family hierarchy)

### Modifying Agent Behavior

- `packages/shared/src/agent/craft-agent.ts` — Main `CraftAgent` class
- `packages/shared/src/agent/core/permission-manager.ts` — `evaluateToolCall()`, permission rules
- `packages/shared/src/agent/core/session-lifecycle.ts` — Session lifecycle events
- `packages/shared/src/agent/backend/` — Per-backend implementations (Claude SDK, Codex, Copilot)

### Adding/Modifying UI Components

- `apps/electron/src/renderer/components/settings/` — `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsToggle`
- `apps/electron/src/renderer/components/ui/` — shadcn/ui primitives (button, dialog, input…)
- `apps/electron/src/renderer/components/app-shell/input/` — Chat input area
- `apps/electron/src/renderer/components/chat/` — Message rendering

### State Management (Jotai)

Atoms live in `apps/electron/src/renderer/atoms/`. Three patterns:
```typescript
// Global atom
export const overlayOpenAtom = atom(false)

// Per-session atom family (avoids cross-session re-renders)
export const sessionAtomFamily = atomFamily((sessionId: string) => atom<Session | undefined>(undefined))

// In component
const [value, setValue] = useAtom(atom)     // read + write
const value = useAtomValue(atom)             // read only
const setValue = useSetAtom(atom)            // write only
```

### Debugging

- Main process logs: `apps/electron/src/main/logger.ts`
- Run `bun run electron:dev:terminal` to see main process output
- Run `bun run print:system-prompt` to inspect agent system prompt
- Config files at runtime: `~/.workagent/config.json`, `~/.workagent/credentials.enc`

## Frequently Changed Files by Area

| Area | Key Files |
|------|-----------|
| Session behavior | `apps/electron/src/main/sessions.ts` |
| Permissions | `packages/shared/src/agent/core/permission-manager.ts` |
| AI/LLM settings UI | `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` |
| Config schema | `packages/shared/src/config/storage.ts` |
| IPC contract | `apps/electron/src/shared/types.ts`, `apps/electron/src/preload/index.ts` |
| Agent backends | `packages/shared/src/agent/backend/craft-agent.ts` |
| MCP/sources | `packages/shared/src/sources/`, `packages/shared/src/mcp/` |
| Localization | `packages/shared/locales/en/`, `packages/shared/locales/zh-CN/` |

## Development Workflow

### Worktree for Every Plan

Every implementation plan **must** be executed in a dedicated git worktree. Never implement a plan directly on `cvte/main` or any shared branch.

```bash
# Before starting implementation
git worktree add .worktrees/feat/<feature-name> -b feat/<feature-name>
```

Use the `superpowers:using-git-worktrees` skill to set this up. The worktree should be created before writing the first line of implementation code.

**Why:** Keeps `cvte/main` clean, enables parallel development across features, and makes it easy to discard or pause work without affecting others.

## Planning Standards

### Engineering Complexity Evaluation

Every implementation plan (`docs/plans/*.md`) **must** include an engineering complexity assessment. Place it in the plan header, after the Architecture section:

```markdown
**Engineering Assessment:** [Over-engineered | Under-engineered | Just right]
**Reason:** [1-2 sentences explaining why]
```

**Criteria:**

| Verdict | Signs |
|---------|-------|
| Over-engineered | Abstractions for hypothetical future use cases; configurable options nobody asked for; generic frameworks for one-time use; more than 2 layers of indirection for simple logic |
| Under-engineered | No error handling at system boundaries; missing tests for critical paths; skipping type safety; ignoring known edge cases that will definitely occur |
| Just right | Solves exactly the stated problem; tests cover real failure modes; no unused flexibility; can explain every line's purpose |

**Examples:**

- Adding a retry mechanism for a download script → Just right (network is unreliable)
- Adding a plugin system for a feature used in one place → Over-engineered
- Skipping error handling for IPC calls that can fail → Under-engineered
- Writing a generic "tool manager" abstraction for two tools → Over-engineered; just handle git and python directly
