/**
 * TypeScript types for config-defaults.json
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 * This file only defines types - the actual defaults come from the bundled JSON.
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

export interface ConfigDefaults {
  version: string;
  description: string;
  defaults: {
    notificationsEnabled: boolean;
    colorTheme: string;
    autoCapitalisation: boolean;
    sendMessageKey: 'enter' | 'cmd-enter';
    spellCheck: boolean;
    keepAwakeWhileRunning: boolean;
    richToolDescriptions: boolean;
    extendedPromptCache: boolean;
    browserToolEnabled: boolean;
    /**
     * Allow remote agents to call `browser_tool evaluate <expression>`.
     * When false, the local dispatcher rejects with `BROWSER_REMOTE_EVALUATE_BLOCKED`.
     */
    allowRemoteEvaluate: boolean;
  };
  workspaceDefaults: {
    thinkingLevel: ThinkingLevel;
    permissionMode: PermissionMode;
    cyclablePermissionModes: PermissionMode[];
    localMcpServers: {
      enabled: boolean;
    };
  };
  /** Enterprise zero-config provisioning (CVTE). Absent in non-enterprise builds. */
  enterprise?: EnterpriseDefaults;
}

export interface EnterpriseLlmConnectionDefaults {
  /** Connection slug, e.g. 'cvte-gateway' */
  slug: string;
  /** Display name shown in connection settings */
  name: string;
  /** Gateway endpoint serving the Anthropic Messages protocol */
  baseUrl: string;
  /** Default model id, e.g. 'CVTE-AUTO' */
  defaultModel: string;
  /** Static model list (gateway also serves /v1/models for discovery) */
  models?: string[];
  /**
   * Shared fallback API key, stored as the connection credential when the
   * user has no personal key yet. Treated as exposed by design — gateway-side
   * quota/audit applies; rotate by shipping a new config-defaults.json.
   */
  fallbackApiKey?: string;
}

export interface EnterpriseDefaults {
  /** Connection to auto-create on first launch when no connections exist */
  defaultLlmConnection?: EnterpriseLlmConnectionDefaults;
  /** Narrow onboarding to the enterprise connection (hide Claude/ChatGPT/Copilot/local choices) */
  hideOtherProviders?: boolean;
}
