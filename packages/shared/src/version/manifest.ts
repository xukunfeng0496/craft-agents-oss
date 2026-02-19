import { debug } from "../utils/debug";

const GITHUB_REPO = 'xukunfeng0496/craft-agents-oss';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export async function getLatestVersion(): Promise<string | null> {
    try {
      const response = await fetch(GITHUB_API_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      const data = await response.json();
      const tagName = (data as { tag_name?: string }).tag_name;
      if (typeof tagName !== 'string') {
        debug('[manifest] Latest version tag is not a valid string');
        return null;
      }
      // Strip leading 'v' and trailing '-cvte' from tag like "v1.2.3-cvte"
      const version = tagName.replace(/^v/, '').replace(/-cvte$/, '');
      return version || null;
    } catch (error) {
      debug(`[manifest] Failed to get latest version: ${error}`);
    }
    return null;
}

export async function getManifest(version: string): Promise<VersionManifest | null> {
    try {
        // Fetch manifest.json from GitHub Release assets
        const tag = `v${version}-cvte`;
        const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/manifest.json`;
        debug(`[manifest] Getting manifest for version: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        return data as VersionManifest;
    } catch (error) {
        debug(`[manifest] Failed to get manifest: ${error}`);
    }
    return null;
}


export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  filename?: string;
}

export interface VersionManifest {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, BinaryInfo>;
}
