import { describe, it, expect } from 'bun:test';
import { enforceCvteGatewayShape } from './cvte-gateway-invariant.ts';
import type { EnterpriseGatewayIdentity } from './enterprise-defaults.ts';
import type { LlmConnection } from './llm-connections.ts';

const ID: EnterpriseGatewayIdentity = {
  slug: 'cvte-gateway',
  host: 'token.cvte.com',
  baseUrl: 'https://token.cvte.com',
  models: ['CVTE-AUTO', 'deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.1', 'qwen3.7-max', 'qwen3.7-plus'],
  defaultModel: 'CVTE-AUTO',
};

function conn(partial: Partial<LlmConnection>): LlmConnection {
  return {
    slug: 'cvte-gateway',
    name: 'CVTE Gateway',
    providerType: 'anthropic',
    authType: 'api_key',
    baseUrl: 'https://token.cvte.com',
    ...partial,
  } as LlmConnection;
}

const ids = (c: LlmConnection) => (c.models ?? []).map((m) => (typeof m === 'string' ? m : m.id));

describe('enforceCvteGatewayShape', () => {
  it('non-enterprise build (null identity) → no-op', () => {
    const c = conn({ providerType: 'pi' });
    expect(enforceCvteGatewayShape(c, null)).toBe(false);
    expect(c.providerType).toBe('pi');
  });

  it('non-gateway connection → untouched', () => {
    const c = conn({ slug: 'my-openai', baseUrl: 'https://api.openai.com/v1', providerType: 'pi_compat', customEndpoint: { api: 'openai-completions' }, models: [{ id: 'gpt-4o' } as never] });
    const before = JSON.stringify(c);
    expect(enforceCvteGatewayShape(c, ID)).toBe(false);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('OAuth gateway connection → untouched', () => {
    const c = conn({ authType: 'oauth', providerType: 'pi' });
    expect(enforceCvteGatewayShape(c, ID)).toBe(false);
  });

  it('healthy Anthropic shape → no change', () => {
    const c = conn({ providerType: 'anthropic', authType: 'api_key', baseUrl: 'https://token.cvte.com', models: [...ID.models], defaultModel: 'CVTE-AUTO' });
    expect(enforceCvteGatewayShape(c, ID)).toBe(false);
  });

  it('legacy pi + GPT catalog → repaired to Anthropic shape with CVTE catalog', () => {
    const c = conn({
      providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai',
      baseUrl: 'https://token.cvte.com',
      models: [{ id: 'pi/gpt-5' } as never, { id: 'pi/o1' } as never],
      defaultModel: 'pi/gpt-5',
    });
    expect(enforceCvteGatewayShape(c, ID)).toBe(true);
    expect(c.providerType).toBe('anthropic');
    expect(c.authType).toBe('api_key');
    expect(c.customEndpoint).toBeUndefined();
    expect(c.piAuthProvider).toBeUndefined();
    expect(ids(c).sort()).toEqual((ID.models as string[]).slice().sort());
    expect(c.defaultModel).toBe('CVTE-AUTO');
  });

  it('bare-host OpenAI (missing /v1) → /v1 enforced', () => {
    const c = conn({
      providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      baseUrl: 'https://token.cvte.com', customEndpoint: { api: 'openai-completions' },
      models: [...ID.models], defaultModel: 'CVTE-AUTO',
    });
    expect(enforceCvteGatewayShape(c, ID)).toBe(true);
    expect(c.baseUrl).toBe('https://token.cvte.com/v1');
    expect(c.providerType).toBe('pi_compat');
    expect(c.customEndpoint?.api).toBe('openai-completions');
    // The Pi openai-completions route needs piAuthProvider to reach the gateway.
    expect(c.piAuthProvider).toBe('openai');
  });

  it('healthy OpenAI shape (/v1 + piAuthProvider) → no change', () => {
    const c = conn({
      providerType: 'pi_compat', authType: 'api_key_with_endpoint', piAuthProvider: 'openai',
      baseUrl: 'https://token.cvte.com/v1', customEndpoint: { api: 'openai-completions' },
      models: [...ID.models], defaultModel: 'CVTE-AUTO', modelSelectionMode: 'automaticallySyncedFromProvider',
    });
    expect(enforceCvteGatewayShape(c, ID)).toBe(false);
  });

  it('Anthropic shape resolved by /v1 host but no customEndpoint stays anthropic & strips /v1', () => {
    // host matches even though baseUrl carries /v1, but no openai customEndpoint → anthropic
    const c = conn({ providerType: 'anthropic', baseUrl: 'https://token.cvte.com/v1', models: [...ID.models] });
    expect(enforceCvteGatewayShape(c, ID)).toBe(true);
    expect(c.baseUrl).toBe('https://token.cvte.com');
  });

  it('preserves a live-refined catalog that is a subset of the CVTE ids', () => {
    // Anthropic live /v1/models could return fewer/same ids — must not be reset
    const c = conn({ providerType: 'anthropic', baseUrl: 'https://token.cvte.com', models: ['CVTE-AUTO', 'deepseek-v4-flash'], defaultModel: 'CVTE-AUTO' });
    expect(enforceCvteGatewayShape(c, ID)).toBe(false);
    expect(ids(c)).toEqual(['CVTE-AUTO', 'deepseek-v4-flash']);
  });
});
