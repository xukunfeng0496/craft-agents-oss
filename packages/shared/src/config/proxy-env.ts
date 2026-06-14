import { getNetworkProxySettings } from './storage.ts';
import { getEnterpriseDefaults } from './enterprise-defaults.ts';

/**
 * CVTE: merge user-configured NO_PROXY with the enterprise intranet domain
 * list (LLM gateway, key relay, update server). Returns null when there is
 * nothing to bypass.
 *
 * Exported so the Electron-side proxy config (undici dispatcher + Chromium
 * session proxyBypassRules) bypasses the same intranet domains — otherwise
 * enabling an in-app HTTP proxy routes token.cvte.com (and the intranet relay)
 * through it and resets the connection.
 */
export function mergedNoProxy(userNoProxy?: string): string | null {
  // loadConfigDefaults() throws until ensureConfigDir() has synced
  // config-defaults.json on first launch — NO_PROXY enrichment is best-effort
  // and must never block startup.
  let enterpriseDomains: string[] = [];
  try {
    enterpriseDomains = getEnterpriseDefaults()?.noProxyDomains ?? [];
  } catch {
    // First launch, before config-defaults sync: fall back to user entries only.
  }
  const parts = new Set<string>();
  for (const entry of (userNoProxy ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) parts.add(trimmed);
  }
  for (const domain of enterpriseDomains) {
    if (domain.trim()) parts.add(domain.trim());
  }
  return parts.size > 0 ? [...parts].join(',') : null;
}

/**
 * Convert stored proxy settings into environment variables for subprocesses.
 *
 * CVTE: the NO_PROXY entries (user + enterprise intranet domains) are
 * returned even when the in-app proxy is disabled — subprocesses may still
 * inherit http_proxy/https_proxy from the user's shell environment, and
 * intranet traffic (token.cvte.com etc.) must never route through a proxy.
 */
export function getProxyEnvVars(): Record<string, string> {
  const settings = getNetworkProxySettings();
  const env: Record<string, string> = {};

  if (settings?.enabled) {
    if (settings.httpProxy) {
      env.HTTP_PROXY = settings.httpProxy;
      env.http_proxy = settings.httpProxy;
    }
    if (settings.httpsProxy) {
      env.HTTPS_PROXY = settings.httpsProxy;
      env.https_proxy = settings.httpsProxy;
    }
  }

  const noProxy = mergedNoProxy(settings?.enabled ? settings.noProxy : undefined);
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }
  return env;
}

/**
 * CVTE: append the enterprise intranet bypass list to the current process's
 * NO_PROXY. Called once at app startup, after shell-env import — protects
 * main-process fetches (marketplace, model refresh, OTA check) from
 * shell-inherited proxies.
 */
export function applyEnterpriseNoProxyToProcessEnv(): void {
  const noProxy = mergedNoProxy(process.env.NO_PROXY ?? process.env.no_proxy);
  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.no_proxy = noProxy;
  }
}
