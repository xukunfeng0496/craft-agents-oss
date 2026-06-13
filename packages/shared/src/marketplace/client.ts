import type { MarketplaceRegistry, MarketplaceSkillFile } from './types.ts';

export const DEFAULT_REGISTRY_URL = 'https://skills.gz.cvte.cn';
export const MARKETPLACE_HOST = new URL(DEFAULT_REGISTRY_URL).host;
export const MARKETPLACE_UNREACHABLE_ERROR = 'MARKETPLACE_UNREACHABLE';
// Distinct, RPC-survivable message prefixes so the renderer can tell a genuine
// connectivity failure apart from an HTTP-status response. These must NOT contain
// the substring 'fetch failed' — the original bug was the marketplace's own
// "Skill files fetch failed: 401" colliding with the connectivity heuristic,
// which mislabeled a login-required 401 as "check your network".
export const MARKETPLACE_AUTH_REQUIRED_ERROR = 'MARKETPLACE_AUTH_REQUIRED';
const MARKETPLACE_HTTP_ERROR_PREFIX = 'MARKETPLACE_HTTP';

export function isMarketplaceConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Our own structured HTTP/auth errors are NEVER connectivity errors.
  if (message.startsWith(MARKETPLACE_AUTH_REQUIRED_ERROR) || message.startsWith(MARKETPLACE_HTTP_ERROR_PREFIX)) {
    return false;
  }
  const lowerMessage = message.toLowerCase();
  return (
    message === MARKETPLACE_UNREACHABLE_ERROR ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network error')
  );
}

/** True when the registry/download endpoint rejected the request for lack of a
 * marketplace login (HTTP 401/403). The marketplace requires 统一门户 SSO to
 * download skill files; browsing the registry is open. */
export function isMarketplaceAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(MARKETPLACE_AUTH_REQUIRED_ERROR);
}

/** The server-provided reason behind an auth error, if any (e.g. "需要登录…"). */
export function marketplaceAuthMessage(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(MARKETPLACE_AUTH_REQUIRED_ERROR)) return undefined;
  const rest = message.slice(MARKETPLACE_AUTH_REQUIRED_ERROR.length).replace(/^:\s*/, '').trim();
  return rest || undefined;
}

/** Throw a classifiable error for a non-2xx marketplace response, carrying the
 * server's JSON error message when present. 401/403 → auth-required. */
async function throwForStatus(res: Response, label: string): Promise<never> {
  let serverMsg = '';
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    serverMsg = body?.error || body?.message || '';
  } catch {
    /* non-JSON body — ignore */
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${MARKETPLACE_AUTH_REQUIRED_ERROR}: ${serverMsg || 'login required'}`);
  }
  throw new Error(`${MARKETPLACE_HTTP_ERROR_PREFIX} ${res.status} (${label})${serverMsg ? `: ${serverMsg}` : ''}`);
}

export class MarketplaceClient {
  private baseUrl: string;

  constructor(registryUrl?: string) {
    this.baseUrl = (registryUrl || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
  }

  private rethrowMarketplaceError(error: unknown): never {
    if (isMarketplaceConnectivityError(error)) {
      throw new Error(MARKETPLACE_UNREACHABLE_ERROR);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error));
  }

  async getRegistry(): Promise<MarketplaceRegistry> {
    try {
      const res = await fetch(`${this.baseUrl}/api/registry`);
      if (!res.ok) await throwForStatus(res, 'registry');
      return await res.json() as MarketplaceRegistry;
    } catch (error) {
      this.rethrowMarketplaceError(error);
    }
  }

  async getSkillFiles(name: string): Promise<MarketplaceSkillFile[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}/files`);
      if (!res.ok) await throwForStatus(res, 'skill files');
      const data = await res.json() as { files: MarketplaceSkillFile[] };
      return data.files;
    } catch (error) {
      this.rethrowMarketplaceError(error);
    }
  }
}
