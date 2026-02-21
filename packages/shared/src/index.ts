/**
 * @work-agent/shared
 *
 * Shared business logic for Work Agent.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { WorkAgent } from '@work-agent/shared/agent';
 *   import { loadStoredConfig } from '@work-agent/shared/config';
 *   import { getCredentialManager } from '@work-agent/shared/credentials';
 *   import { CraftMcpClient } from '@work-agent/shared/mcp';
 *   import { debug } from '@work-agent/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@work-agent/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@work-agent/shared/workspaces';
 *
 * Available modules:
 *   - agent: WorkAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
