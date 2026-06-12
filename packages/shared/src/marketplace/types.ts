import type { SkillMetadata } from '../skills/types.ts';

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

export interface MarketplaceSkillPreview {
  slug: string;
  metadata: SkillMetadata;
  content: string;
  author: string;
  tags: string[];
  version: string;
  updatedAt: string;
}
