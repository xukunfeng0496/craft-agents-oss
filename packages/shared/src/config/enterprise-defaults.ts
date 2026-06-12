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

export function getEnterpriseDefaults(): EnterpriseDefaults | undefined {
  return loadConfigDefaults().enterprise;
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
