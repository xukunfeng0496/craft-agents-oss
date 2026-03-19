export interface MarketplaceSkillMeta {
  name: string;
  displayName: string;
  description: string;
  author: string;
  tags: string[];
  compatibility: string[];
  version: string;
  updatedAt: string;
}

export interface MarketplaceRegistry {
  version: number;
  updatedAt: string;
  skills: MarketplaceSkillMeta[];
}

export interface MarketplaceSkillFile {
  path: string;
  content: string;
}
