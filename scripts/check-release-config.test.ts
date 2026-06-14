import { describe, it, expect } from 'bun:test';
import { findReleaseConfigIssues } from './check-release-config.ts';

const prodOk = {
  enterprise: {
    sso: { portalHost: 'home.cvte.com', clientId: 'prod-client-xyz', relayUrl: 'https://key-relay.cvte.com' },
    defaultLlmConnection: { fallbackApiKey: 'sk-rotated-limited' },
  },
};

describe('findReleaseConfigIssues', () => {
  it('flags the op-fat test portal', () => {
    const cfg = { enterprise: { sso: { portalHost: 'op-fat.cvte.com', clientId: 'x', relayUrl: 'https://r' } } };
    expect(findReleaseConfigIssues(cfg).map(i => i.field)).toContain('enterprise.sso.portalHost');
  });

  it('flags the shared test client_id', () => {
    const cfg = { enterprise: { sso: { portalHost: 'home.cvte.com', clientId: 'e1fe00c2088543f3b7ade4d7fb7f4e5c', relayUrl: 'https://r' } } };
    expect(findReleaseConfigIssues(cfg).map(i => i.field)).toContain('enterprise.sso.clientId');
  });

  it('flags a localhost / non-https relay', () => {
    for (const relayUrl of ['http://127.0.0.1:8788', 'http://localhost:8788', 'http://key-relay.cvte.com']) {
      const cfg = { enterprise: { sso: { portalHost: 'home.cvte.com', clientId: 'x', relayUrl } } };
      expect(findReleaseConfigIssues(cfg).map(i => i.field)).toContain('enterprise.sso.relayUrl');
    }
  });

  it('flags the known plaintext fallback key', () => {
    const cfg = { enterprise: { defaultLlmConnection: { fallbackApiKey: '***REMOVED-LEAKED-FALLBACK-KEY***' } } };
    expect(findReleaseConfigIssues(cfg).map(i => i.field)).toContain('enterprise.defaultLlmConnection.fallbackApiKey');
  });

  it('a fully backfilled production config passes', () => {
    expect(findReleaseConfigIssues(prodOk)).toEqual([]);
  });

  it('a non-enterprise config is a no-op', () => {
    expect(findReleaseConfigIssues({})).toEqual([]);
  });
});
