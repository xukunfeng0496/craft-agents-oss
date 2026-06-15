/**
 * TypeScript types for config-defaults.json
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 * This file only defines types - the actual defaults come from the bundled JSON.
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { ModelDefinition } from './models.ts';

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
  /**
   * Static model catalog: plain ids or full ModelDefinition objects.
   * Object entries carry user-facing metadata (name/description/contextWindow/
   * supportsImages) that the live /v1/models fetch merges in — the gateway
   * doesn't expose capability fields yet, so this is their source of truth.
   */
  models?: Array<string | ModelDefinition>;
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
  /** Markdown appended to the agent system prompt under '## Enterprise Context' */
  promptAppendix?: string;
  /**
   * Base URL of the CVTE-hosted session viewer (D11). Session sharing uploads
   * the full transcript here instead of the public Craft viewer
   * (agents.craft.do), keeping internal data on the intranet. When this is
   * absent on an enterprise build, session sharing is disabled outright so a
   * transcript can never egress to the public viewer by default. Set this to
   * the deployed intranet viewer (apps/viewer) origin to re-enable sharing.
   */
  viewerUrl?: string;
  /**
   * Domain suffixes that must always bypass HTTP proxies (intranet services:
   * gateway, key API, skills registry, update server). Merged into NO_PROXY
   * for the main process and every subprocess.
   */
  noProxyDomains?: string[];
  /**
   * CVTE 统一门户 SSO closed-loop (D8 §六). When present, onboarding can offer a
   * one-click "CVTE 门户登录" that authenticates against the portal, resolves the
   * user's personal gateway key via the intranet relay, and auto-configures the
   * gateway connection. Absent ⇒ the SSO option is hidden (fallback key path
   * still applies).
   */
  sso?: EnterpriseSsoConfig;
  /**
   * Sentry DSN for client crash/error reporting, pointing at the intranet Sentry
   * (sentry-ali.cvtapi.com). A client-side public identifier — NOT a secret (same
   * class as fallbackApiKey). Read synchronously at Sentry init (before
   * config-defaults sync), enabling crash/exception/console.error reporting.
   * Absent ⇒ Sentry disabled. Keep it on an intranet endpoint so transcripts /
   * error context never egress to a public Sentry.
   */
  sentryDsn?: string;
}

export interface EnterpriseSsoConfig {
  /** Portal host — `op-fat.cvte.com` (test) / `home.cvte.com` (prod). */
  portalHost: string;
  /** OAuth2 public client id registered for Work Agents in this environment. */
  clientId: string;
  /**
   * Intranet key-relay origin (@craft-agent/portal-key-relay). Receives the
   * portal access token and returns the user's personal CCH key. Holds the
   * admin X-Api-Key server-side — never expose that key in this config.
   */
  relayUrl: string;
}
