/**
 * CVTE enterprise gateway connection invariant (D8).
 *
 * The gateway serves two protocols, so a gateway connection has exactly two
 * legal shapes — and the *only* durable signal that survives a mangled save is
 * `customEndpoint.api === 'openai-completions'`:
 *
 *   Anthropic shape   providerType 'anthropic', baseUrl token.cvte.com,
 *                     no customEndpoint, Claude Agent SDK route.
 *   OpenAI shape      providerType 'pi_compat', baseUrl token.cvte.com/v1
 *                     (the `/v1` is mandatory — a bare host 307-redirects to a
 *                     login page and the Pi SDK silently returns an empty
 *                     reply), customEndpoint {api:'openai-completions'}.
 *
 * `enforceCvteGatewayShape` reads ONLY that one signal and derives every other
 * field, so no matter how broken the connection got (downgraded to `pi`, Pi GPT
 * catalog leaked into `models`, bare-host OpenAI URL), it lands in exactly one
 * legal shape. Called from the every-launch normalizer (storage.ts) and the
 * every-setup handler (server-core) so the two paths can never drift.
 */
import type { LlmConnection, LlmProviderType, LlmAuthType } from './llm-connections.ts';
import type { ModelDefinition } from './models.ts';
import { getEnterpriseGatewayIdentity, type EnterpriseGatewayIdentity } from './enterprise-defaults.ts';

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

function modelId(m: string | ModelDefinition): string {
  return typeof m === 'string' ? m : m.id;
}

/**
 * Coerce a single gateway connection in place to its canonical shape.
 * Returns true if anything changed. No-op (returns false) for non-gateway
 * connections, OAuth connections, and non-enterprise builds — so it is safe to
 * call over every connection in the config.
 */
export function enforceCvteGatewayShape(
  conn: LlmConnection,
  identity: EnterpriseGatewayIdentity | null = getEnterpriseGatewayIdentity(),
): boolean {
  const id = identity;
  if (!id) return false;
  // Only touch connections that point at the gateway (host match or the
  // provisioned slug). Deliberate non-gateway connections are never mutated.
  if (hostOf(conn.baseUrl) !== id.host && conn.slug !== id.slug) return false;
  // Never rewrite an OAuth connection's auth shape.
  if (conn.authType === 'oauth') return false;

  let changed = false;
  const set = <K extends keyof LlmConnection>(key: K, value: LlmConnection[K]): void => {
    // structural compare is overkill here; values are primitives or small objects
    const before = JSON.stringify(conn[key]);
    const after = JSON.stringify(value);
    if (before !== after) {
      conn[key] = value;
      changed = true;
    }
  };

  // The shape is decided by the one durable signal; everything else is derived.
  const wantsOpenAi = conn.customEndpoint?.api === 'openai-completions';

  if (wantsOpenAi) {
    set('providerType', 'pi_compat' as LlmProviderType);
    set('authType', 'api_key_with_endpoint' as LlmAuthType);
    set('customEndpoint', { api: 'openai-completions' });
    // `/v1` is mandatory and idempotent — repair bare host and any double-/v1.
    set('baseUrl', `${id.baseUrl}/v1`);
    // The Pi openai-completions adapter routes on piAuthProvider — required for
    // this shape, so a chat actually reaches the gateway (without it the Pi SDK
    // returns an empty reply).
    set('piAuthProvider', 'openai');
  } else {
    set('providerType', 'anthropic' as LlmProviderType);
    set('authType', 'api_key' as LlmAuthType);
    set('customEndpoint', undefined);
    set('baseUrl', id.baseUrl);
    // Anthropic shape carries no piAuthProvider — scrub `pi`-downgrade residue.
    if (conn.piAuthProvider !== undefined) {
      delete conn.piAuthProvider;
      changed = true;
    }
  }

  // Catalog guard — repairs drift, never clobbers a legitimate live expansion.
  // This runs on every launch (not a one-time migration), and the gateway's
  // `/v1/models` refresh (server-core model-fetchers) legitimately persists
  // newly-added gateway models into `conn.models` — the Anthropic shape is not
  // in the compat-provider skip list, so it gets refreshed like any other
  // provider. A strict "is currentIds a subset of the catalog" check treated
  // that legitimate growth as corruption and reset the whole catalog back to
  // seed on every subsequent launch, silently discarding the user's
  // `defaultModel` selection along with it. The actual failure mode this guard
  // must catch is *drift*, not *growth*: the Pi GPT / Claude catalog (or any
  // other provider's models) leaking wholesale into this connection. That only
  // happens when the stored ids share nothing with the CVTE catalog — a
  // superset (seed + new gateway models) is healthy and must be left alone.
  const catalogIds = new Set(id.models.map(modelId));
  const currentIds = (conn.models ?? []).map(modelId);
  const catalogIsDrifted = currentIds.length === 0 || currentIds.every((m) => !catalogIds.has(m));
  if (catalogIsDrifted) {
    conn.models = id.models.map((m) => (typeof m === 'string' ? m : { ...m }));
    conn.defaultModel = id.defaultModel;
    conn.modelSelectionMode = 'automaticallySyncedFromProvider';
    changed = true;
  } else if (!currentIds.includes(conn.defaultModel ?? '')) {
    // Catalog itself is healthy (subset, superset, or partial overlap), but the
    // selected default fell out of it (e.g. the gateway retired that model) —
    // repair only the pointer, don't touch the rest of the catalog.
    set('defaultModel', id.defaultModel);
  }

  return changed;
}
