# Agent Tooling And Attachment Compatibility Design

**Date**: 2026-03-16
**Status**: Draft for implementation
**Author**: Codex + User

## Overview

This design addresses two related reliability problems in the Claude Agent SDK integration:

1. Regular ClaudeAgent sessions frequently lose native Claude Code tools such as `Read`, `Bash`, `Glob`, `Task`, and `Skill`.
2. Attachment handling is inconsistent across entry points, especially for Office files and PDF behavior under multi-model routing (`CVTE-AUTO` and other anthropic-compatible backends).

The immediate priority is to restore native tool availability for regular sessions. After that, the attachment pipeline must be normalized so desktop and remote-control sessions produce the same stored artifacts and agent-visible metadata.

## Confirmed Root Causes

### 1. SDK `tools` contract is violated in regular ClaudeAgent sessions

Regular ClaudeAgent chat builds `tools` as an array containing a preset object plus custom browser tool objects in [packages/shared/src/agent/claude-agent.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/claude-agent.ts).

The SDK type contract only accepts:

- `string[]`
- a single preset object `{ type: 'preset', preset: 'claude_code' }`

This is declared in [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/kun/code/litchi/craft-agents-oss/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts).

At runtime, SDK serialization joins arrays into `--tools a,b,c`. Passing objects inside that array produces invalid CLI arguments and prevents native tool exposure.

### 2. Browser tools are attached through the wrong channel

Browser tooling is currently created via `createBrowserTools()` and mixed directly into the SDK `tools` option. The repository already uses the correct pattern for first-party custom tools elsewhere:

- `preferences` MCP server
- `session` MCP server
- `call_llm` MCP tool

This indicates browser tooling should also be exposed through a session-scoped MCP server instead of the SDK built-in `tools` option.

### 3. Attachment storage behavior differs across entry points

Desktop attachment storage in [apps/electron/src/main/ipc.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/ipc.ts) performs:

- persistent file storage
- image resizing
- thumbnail generation
- Office to markdown conversion using `markitdown-js` in a worker thread

Remote-control message ingestion in [apps/electron/src/main/sessions.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/sessions.ts) bypasses that pipeline and instead performs a simplified attachment write:

- `office` attachments are excluded from `ALLOWED_TYPES`
- no `markdownPath` is generated
- no unified sidecar artifacts are produced

### 4. PDF handling assumes Claude-native document blocks even when routed model is not Claude

ClaudeAgent currently uploads PDFs inline as `document` blocks whenever attachments include `pdf`. That path is acceptable for Claude-native models but is not safe to assume for arbitrary anthropic-compatible routed models behind `CVTE-AUTO`.

### 5. Model capability metadata is too weak for multi-model attachment policy

The model registry currently tracks only basic metadata and `supportsThinking`. It does not capture document, image, or structured-output compatibility. As a result, attachment strategy relies on name heuristics such as `isClaudeModel()` instead of explicit capability gating.

## Goals

### Primary Goals

1. Restore stable native tool availability in regular ClaudeAgent sessions.
2. Move browser tooling onto the same MCP-based architecture used by other first-party custom tools.
3. Normalize attachment storage so desktop and remote-control flows produce the same stored metadata and sidecar outputs.
4. Reduce provider-specific assumptions in PDF and Office processing.

### Secondary Goals

1. Preserve current desktop UX, including thumbnails and optimistic attachment display.
2. Keep Office conversion deterministic and off the main thread.
3. Add regression tests so future SDK upgrades cannot silently break tool exposure again.

## Non-Goals

1. Replacing `markitdown-js` in this phase.
2. Building a full OCR pipeline in this phase.
3. Solving all cross-provider multimodal differences in one change set.
4. Refactoring `call_llm` into a binary document ingestion tool.

## Proposed Implementation

## Phase 1: Restore Native Tool Exposure

### Change

Update regular ClaudeAgent session options so `tools` uses a valid SDK-supported shape:

- mini agent path remains `string[]`
- regular path uses only `{ type: 'preset', preset: 'claude_code' }`
- no custom tool objects are mixed into `tools`

### Files

- [packages/shared/src/agent/claude-agent.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/claude-agent.ts)

### Expected Outcome

Regular sessions regain native built-in tools:

- `Read`
- `Bash`
- `Glob`
- `Grep`
- `Task`
- `Skill`

This is the first gating fix. Later attachment and skill validation depends on it.

## Phase 2: Move Browser Tooling To Session MCP

### Change

Expose `browser_tool` through the existing session-scoped MCP server instead of the SDK `tools` field.

### Files

- [packages/shared/src/agent/session-scoped-tools.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/session-scoped-tools.ts)
- [packages/shared/src/agent/browser-tools.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/browser-tools.ts)
- [packages/shared/src/agent/claude-agent.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/claude-agent.ts)

### Design

- Extend `SessionScopedToolCallbacks` to carry `getBrowserPaneFns`
- Register that callback from ClaudeAgent session setup
- Build a `browser_tool` MCP tool inside the session-scoped server using the existing runtime and command parser
- Preserve the existing tool name `browser_tool` so current prompt guidance and permission rules remain valid
- Allow SDK to expose the tool as `mcp__session__browser_tool`

### Expected Outcome

- Native Claude tools remain isolated in SDK preset handling
- Browser tooling aligns with the architecture already used by `call_llm`, `SubmitPlan`, and other session tools
- Permission tests can consistently target both `browser_tool` and `mcp__session__browser_tool`

## Phase 3: Normalize Attachment Storage Paths

### Change

Remote-control attachment ingestion should reuse the same storage and conversion path as desktop `STORE_ATTACHMENT`, or a shared helper factored out of it.

### Files

- [apps/electron/src/main/ipc.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/ipc.ts)
- [apps/electron/src/main/sessions.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/sessions.ts)
- possibly a new shared helper under `apps/electron/src/main/`

### Design

- Extract attachment persistence into a shared helper returning `StoredAttachment`
- Use that helper from:
  - `IPC_CHANNELS.STORE_ATTACHMENT`
  - remote-control `send_message`
- Ensure `office` attachments are accepted in remote-control flows
- Ensure Office conversion generates `markdownPath` in all supported entry points

### Expected Outcome

For the same attachment type and content, desktop and remote-control sessions produce equivalent:

- `storedPath`
- `markdownPath` for Office inputs
- resize behavior for images
- consistent persistence metadata

## Phase 4: Introduce Provider-Aware Attachment Policy

### Change

Stop assuming all routed models can consume inline PDF `document` blocks simply because the outer SDK path is ClaudeAgent.

### Files

- [packages/shared/src/config/models.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/config/models.ts)
- [packages/shared/src/agent/claude-agent.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/claude-agent.ts)
- possibly connection metadata under config storage if capability overrides live with LLM connections

### Design

Introduce explicit capability fields, either on model definitions or connection/runtime capability overrides:

- `supportsVision`
- `supportsDocumentBlocks`
- `supportsStrictStructuredOutput`
- `supportsReliableToolUse`
- `preferredDocumentIngestion` with values such as `inline_document`, `sidecar_text`, `ocr_required`

Initial policy:

- Claude-native models may continue using inline PDF `document` blocks
- non-Claude or unknown anthropic-compatible routes should prefer sidecar text/markdown paths when available
- Office files should continue to prefer deterministic markdown sidecars over raw binary

### Expected Outcome

Attachment behavior becomes capability-driven instead of name-heuristic-driven.

## Phase 5: Optional PDF Sidecar Extraction Follow-Up

This is explicitly a follow-up phase, not required to fix the current outage.

Potential direction:

- add deterministic PDF text extraction sidecar for non-Claude-compatible routes
- keep inline PDF upload as a Claude-enhancement path
- add OCR fallback only for scanned PDFs

## Automated Test Strategy

## A. Unit Tests

### 1. ClaudeAgent tool option shape

Add tests that verify:

- mini agent uses `string[]`
- regular agent uses a single preset object
- regular agent does not mix custom browser tool objects into `tools`

Suggested location:

- [packages/shared/src/agent/__tests__/claude-agent-session-recovery.test.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/__tests__/claude-agent-session-recovery.test.ts) if existing harness is convenient
- or a new focused test file under `packages/shared/src/agent/__tests__/`

### 2. Session-scoped browser tool registration

Add tests that verify:

- `getSessionScopedTools()` includes `browser_tool` when browser callbacks are registered
- absence of callbacks yields a clean error path instead of missing-tool registration failure

Suggested location:

- new test file near [packages/shared/src/agent/__tests__/browser-tools.test.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/__tests__/browser-tools.test.ts)

### 3. Permission coverage

Extend existing permission tests to confirm session MCP browser tool remains allowed in safe and ask modes.

Relevant existing test:

- [packages/shared/src/agent/__tests__/browser-tools-permissions.test.ts](/Users/kun/code/litchi/craft-agents-oss/packages/shared/src/agent/__tests__/browser-tools-permissions.test.ts)

### 4. Attachment helper parity

If attachment storage is extracted into a shared helper, add unit tests that verify:

- office files produce `markdownPath` when conversion succeeds
- conversion failure degrades gracefully without dropping the original attachment
- remote-control and desktop callers receive the same stored metadata shape

## B. Integration Tests

### 1. Remote-control attachment ingestion

Add tests around remote-control `send_message` flow to verify:

- `office` attachments are accepted
- `markdownPath` survives into persisted message attachments
- agent-visible attachment metadata includes `[Markdown version: ...]`

Relevant area:

- [apps/electron/src/main/sessions.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/sessions.ts)
- [apps/electron/src/main/session-recovery-format.ts](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/main/session-recovery-format.ts)

### 2. Renderer attachment send path

Add or extend tests confirming renderer forwards `stored.markdownPath` into `processedAttachments` before send.

Relevant file:

- [apps/electron/src/renderer/App.tsx](/Users/kun/code/litchi/craft-agents-oss/apps/electron/src/renderer/App.tsx)

## C. Regression Tests For The Original Failure

### 1. Broken native tool absence

Create a test harness that captures final SDK query options and asserts:

- regular sessions do not pass `tools` as an array of objects
- browser enablement does not alter the built-in tools preset shape

### 2. Example attachment expectations

Add representative fixture tests for:

- `.txt` attachment
- `.pdf` attachment
- `.xlsx` attachment with generated markdown sidecar

## Risks

1. Moving browser tooling into MCP may alter the exact SDK-visible name and affect prompt guidance or telemetry.
2. Shared attachment helper extraction may touch both desktop and remote-control paths and introduce persistence regressions.
3. Provider-aware PDF policy may need a temporary conservative fallback for `CVTE-AUTO` until routing capability metadata is explicit.

## Rollout Order

1. Phase 1: fix native tool shape
2. Phase 2: move browser tool to session MCP
3. Phase 3: normalize attachment entry points
4. Add regression tests for phases 1 through 3
5. Phase 4 capability gating

## Open Questions

1. Should `CVTE-AUTO` be treated as "unknown multimodal compatibility" by default unless the platform returns explicit capability metadata?
2. Is remote-control expected to support Office attachments immediately, or is parity acceptable if gated behind a minor release flag?
3. Should PDF sidecar extraction be introduced immediately for non-Claude-compatible routes, or deferred until post-fix validation data is collected?

## Immediate Implementation Scope

For the first implementation pass in this repository, proceed with:

1. Phase 1
2. Phase 2
3. Phase 3
4. automated tests for those phases

Capability-gated PDF policy should be prepared in code structure and design notes, but can remain a follow-up if the first pass already restores the broken workflows.
