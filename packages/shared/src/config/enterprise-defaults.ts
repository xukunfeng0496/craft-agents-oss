/**
 * Enterprise zero-config provisioning (CVTE customization).
 *
 * On first launch with no LLM connections, creates the gateway connection
 * declared in bundled config-defaults.json (`enterprise.defaultLlmConnection`),
 * then backfills the shared fallback API key when the user has none — so a
 * fresh install can chat immediately and onboarding is skipped entirely.
 *
 * Route follows decision D8: providerType 'anthropic' + baseUrl, running on
 * the Claude Agent SDK (NOT the upstream pi_compat auto-switch path).
 */
import {
  loadConfigDefaults,
  loadStoredConfig,
  saveConfig,
  getLlmConnections,
  addLlmConnection,
  getDefaultLlmConnection,
  setDefaultLlmConnection,
} from './storage.ts';
import type { EnterpriseDefaults } from './config-defaults-schema.ts';
import type { LlmConnection } from './llm-connections.ts';
import type { ModelDefinition } from './models.ts';
import { VIEWER_URL } from '../branding.ts';

export function getEnterpriseDefaults(): EnterpriseDefaults | undefined {
  return loadConfigDefaults().enterprise;
}

/** Canonical identity of the CVTE enterprise gateway, or null on non-enterprise builds. */
export interface EnterpriseGatewayIdentity {
  slug: string;
  /** Host of the gateway (e.g. `token.cvte.com`). */
  host: string;
  /** Canonical Anthropic-shape base URL — no `/v1`, no trailing slash. */
  baseUrl: string;
  /** Seed model catalog (the gateway `/v1/models` set). */
  models: Array<string | ModelDefinition>;
  defaultModel: string;
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * Single source of truth for the enterprise gateway's identity, derived from
 * `enterprise.defaultLlmConnection` in config-defaults.json. Returns null on
 * non-enterprise builds (or before config-defaults has been synced) so every
 * caller safely no-ops. Fail-soft: never throws.
 */
export function getEnterpriseGatewayIdentity(): EnterpriseGatewayIdentity | null {
  let ent: EnterpriseDefaults | undefined;
  try {
    ent = getEnterpriseDefaults();
  } catch {
    return null;
  }
  const conn = ent?.defaultLlmConnection;
  if (!conn?.slug || !conn.baseUrl) return null;
  const host = hostOf(conn.baseUrl);
  if (!host) return null;
  return {
    slug: conn.slug,
    host,
    baseUrl: conn.baseUrl.replace(/\/+$/, ''),
    models: conn.models ?? [],
    defaultModel: conn.defaultModel,
  };
}

/**
 * True when `url`'s host matches the enterprise gateway host — so both the
 * Anthropic shape (`token.cvte.com`) and the OpenAI shape (`token.cvte.com/v1`)
 * resolve to the gateway. Fail-soft: false on non-enterprise builds / parse error.
 */
export function isEnterpriseGatewayHost(url: string | undefined): boolean {
  const id = getEnterpriseGatewayIdentity();
  if (!id) return false;
  return hostOf(url) === id.host;
}

/**
 * Resolve the session-viewer base URL for sharing (D11).
 *
 *  - Enterprise build **with** `enterprise.viewerUrl` → that intranet viewer.
 *  - Enterprise build **without** `viewerUrl` → `null`: sharing is disabled so
 *    a transcript can never egress to the public Craft viewer by default. The
 *    caller surfaces a "sharing not configured" error instead of uploading.
 *  - Non-enterprise build → the bundled default (`agents.craft.do`), preserving
 *    upstream behavior.
 *
 * Best-effort: never throws (config-defaults may be unread very early in
 * startup), though the share paths that call this always run post-startup.
 */
export function resolveViewerUrl(): string | null {
  let enterprise: EnterpriseDefaults | undefined;
  try {
    enterprise = getEnterpriseDefaults();
  } catch {
    return VIEWER_URL;
  }
  if (!enterprise) return VIEWER_URL;
  const configured = enterprise.viewerUrl?.trim();
  if (configured) return configured.replace(/\/$/, '');
  // Enterprise build, no intranet viewer configured → sharing disabled.
  return null;
}

/**
 * Provision the enterprise default connection and its fallback credential.
 * Idempotent; safe to call on every launch. Returns true when anything changed.
 *
 * - Connection is only created on installs with no connections at all —
 *   migrated legacy gateway connections (anthropic_compat → anthropic) take
 *   precedence over provisioning.
 * - The fallback API key is backfilled whenever the enterprise connection
 *   exists but has no stored key (fresh install, or user deleted their key).
 *   A personal key entered later simply overwrites it.
 */
export async function ensureEnterpriseDefaultConnection(): Promise<boolean> {
  const ent = getEnterpriseDefaults()?.defaultLlmConnection;
  if (!ent?.slug || !ent.baseUrl) return false;

  let changed = false;
  const existing = getLlmConnections();

  if (existing.length === 0) {
    const connection: LlmConnection = {
      slug: ent.slug,
      name: ent.name,
      providerType: 'anthropic',
      authType: 'api_key',
      baseUrl: ent.baseUrl,
      defaultModel: ent.defaultModel,
      models: ent.models,
      midStreamBehavior: 'queue',
      createdAt: Date.now(),
    };
    if (addLlmConnection(connection)) {
      changed = true;
      if (!getDefaultLlmConnection()) {
        setDefaultLlmConnection(ent.slug);
      }
    }
  }

  // Fallback key handling for every connection pointing at the gateway host
  // (migrated legacy connections keep their own slug):
  // - no stored key → backfill the shared fallback key
  // - endpoint was just rewritten from the legacy test gateway → the stored
  //   test-environment key is stale on the official gateway; replace it once
  //   (guarded by the rewritten/consumed marker pair).
  // Lazy import avoids a config ↔ credentials module cycle.
  if (ent.fallbackApiKey) {
    const hostOf = (url?: string): string | null => {
      try { return url ? new URL(url).host : null; } catch { return null; }
    };
    const entHost = hostOf(ent.baseUrl);
    const gatewayConnections = getLlmConnections().filter((c) => hostOf(c.baseUrl) === entHost);
    if (entHost && gatewayConnections.length > 0) {
      const { getCredentialManager } = await import('../credentials/index.ts');
      const manager = getCredentialManager();

      const REWRITTEN = 'cvte-gateway-endpoint-rewritten-1';
      const CONSUMED = 'cvte-gateway-stale-key-replaced-1';
      const config = loadStoredConfig();
      const mustReplaceStaleKey = !!config?.migrationsApplied?.includes(REWRITTEN)
        && !config.migrationsApplied?.includes(CONSUMED);

      for (const connection of gatewayConnections) {
        const storedKey = await manager.getLlmApiKey(connection.slug);
        if (!storedKey || mustReplaceStaleKey) {
          await manager.setLlmApiKey(connection.slug, ent.fallbackApiKey);
          changed = true;
        }
      }

      if (mustReplaceStaleKey && config) {
        config.migrationsApplied = [...(config.migrationsApplied ?? []), CONSUMED];
        saveConfig(config);
      }
    }
  }

  return changed;
}
