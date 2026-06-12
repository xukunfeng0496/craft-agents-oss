import type { MarketplaceRegistry, MarketplaceSkillFile } from './types.ts';

export const DEFAULT_REGISTRY_URL = 'https://skills.gz.cvte.cn';
export const MARKETPLACE_HOST = new URL(DEFAULT_REGISTRY_URL).host;
export const MARKETPLACE_UNREACHABLE_ERROR = 'MARKETPLACE_UNREACHABLE';

export function isMarketplaceConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
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
      if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
      return await res.json() as MarketplaceRegistry;
    } catch (error) {
      this.rethrowMarketplaceError(error);
    }
  }

  async getSkillFiles(name: string): Promise<MarketplaceSkillFile[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}/files`);
      if (!res.ok) throw new Error(`Skill files fetch failed: ${res.status}`);
      const data = await res.json() as { files: MarketplaceSkillFile[] };
      return data.files;
    } catch (error) {
      this.rethrowMarketplaceError(error);
    }
  }
}
