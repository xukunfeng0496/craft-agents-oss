import type { MarketplaceRegistry, MarketplaceSkillFile } from './types.ts';

const DEFAULT_REGISTRY_URL = 'https://skills.gz.cvte.cn';

export class MarketplaceClient {
  private baseUrl: string;

  constructor(registryUrl?: string) {
    this.baseUrl = (registryUrl || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
  }

  async getRegistry(): Promise<MarketplaceRegistry> {
    const res = await fetch(`${this.baseUrl}/api/registry`);
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
    return res.json();
  }

  async getSkillFiles(name: string): Promise<MarketplaceSkillFile[]> {
    const res = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}/files`);
    if (!res.ok) throw new Error(`Skill files fetch failed: ${res.status}`);
    const data = await res.json();
    return data.files;
  }
}
