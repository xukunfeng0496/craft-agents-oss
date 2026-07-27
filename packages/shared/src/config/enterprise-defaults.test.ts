/**
 * D11 air-gap guard: resolveViewerUrl() must never fail open to the public
 * viewer once a config-defaults.json with an `enterprise` block has been
 * read successfully — see enterprise-defaults.ts for the full contract.
 *
 * Spy on storage.ts's loadConfigDefaults() instead of mock.module(): Bun
 * module mocks leak across files in the same test process, which would mask
 * storage.ts regressions in neighboring config tests (see the same pattern
 * in sources/__tests__/token-refresh-manager.test.ts).
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { VIEWER_URL } from '../branding.ts';
import * as storage from './storage.ts';
import { resolveViewerUrl } from './enterprise-defaults.ts';
import type { ConfigDefaults } from './config-defaults-schema.ts';

let loadConfigDefaultsSpy: ReturnType<typeof spyOn> | null = null;

function stubLoadConfigDefaults(impl: () => ConfigDefaults) {
  loadConfigDefaultsSpy = spyOn(storage, 'loadConfigDefaults').mockImplementation(impl);
}

afterEach(() => {
  loadConfigDefaultsSpy?.mockRestore();
  loadConfigDefaultsSpy = null;
});

const enterpriseWith = (viewerUrl?: string): ConfigDefaults =>
  ({
    enterprise: {
      viewerUrl,
      defaultLlmConnection: { slug: 'cvte-gateway', name: 'CVTE Gateway', baseUrl: 'https://token.cvte.com', defaultModel: 'CVTE-AUTO' },
    },
  }) as ConfigDefaults;

describe('resolveViewerUrl (D11 air-gap guard)', () => {
  // Order matters: `sawEnterprise` is a module-level latch that only flips on
  // (never off), so the non-enterprise case must assert before anything latches it.
  it('upstream/non-enterprise build (no enterprise block) → public VIEWER_URL', () => {
    stubLoadConfigDefaults(() => ({}) as ConfigDefaults);
    expect(resolveViewerUrl()).toBe(VIEWER_URL);
  });

  it('enterprise config with no viewerUrl → sharing disabled (null)', () => {
    stubLoadConfigDefaults(() => enterpriseWith(undefined));
    expect(resolveViewerUrl()).toBeNull();
  });

  it('once enterprise is confirmed, a later read failure fails closed (null), never public VIEWER_URL', () => {
    // Successful enterprise read first — latches the module's sawEnterprise flag.
    stubLoadConfigDefaults(() => enterpriseWith('https://viewer.intranet.cvte.com/'));
    expect(resolveViewerUrl()).toBe('https://viewer.intranet.cvte.com');

    // config-defaults.json now missing/corrupt → loadConfigDefaults throws.
    loadConfigDefaultsSpy?.mockImplementation(() => {
      throw new Error('config-defaults.json not found');
    });
    expect(resolveViewerUrl()).toBeNull();
  });

  it('once enterprise is confirmed, a read that lost the enterprise block also fails closed (null)', () => {
    // Mis-packaged build: getBundledAssetsDir() returns null, so storage writes
    // FALLBACK_CONFIG_DEFAULTS — the read succeeds but carries no `enterprise`.
    stubLoadConfigDefaults(() => ({}) as ConfigDefaults);
    expect(resolveViewerUrl()).toBeNull();
  });
});
