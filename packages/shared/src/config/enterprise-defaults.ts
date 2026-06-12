/**
 * Enterprise zero-config provisioning (CVTE customization).
 *
 * On first launch with no LLM connections, creates the gateway connection
 * declared in bundled config-defaults.json (`enterprise.defaultLlmConnection`)
 * so onboarding collapses to a single "paste your API key" step.
 *
 * Route follows decision D8: providerType 'anthropic' + baseUrl, running on
 * the Claude Agent SDK (NOT the upstream pi_compat auto-switch path).
 */
import {
  loadConfigDefaults,
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
 * Provision the enterprise default connection if this install has none.
 * Idempotent; returns true only when a connection was created.
 *
 * Deliberately skips machines that already have connections — migrated
 * legacy gateway connections (anthropic_compat → anthropic) take precedence.
 */
export function ensureEnterpriseDefaultConnection(): boolean {
  const ent = getEnterpriseDefaults()?.defaultLlmConnection;
  if (!ent?.slug || !ent.baseUrl) return false;

  const existing = getLlmConnections();
  if (existing.length > 0) return false;

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

  if (!addLlmConnection(connection)) return false;
  if (!getDefaultLlmConnection()) {
    setDefaultLlmConnection(ent.slug);
  }
  return true;
}
