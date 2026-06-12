# Sync GitHub Release to Fast Update Server

Sync artifacts from a GitHub Release to the fast-update-server OTA system.

## Arguments

- `$ARGUMENTS` — the version number to sync (e.g. `0.8.0`). If not provided, use the current version from `apps/electron/package.json`.

## Overview

This command:
1. Fetches the release assets from GitHub for `v{version}`
2. Downloads each artifact to a temp directory
3. Uploads each artifact to the fast-update-server
4. Uploads the changelog (RELEASE_NOTES.md) to the server

## Config

| Variable | Default | Description |
|---|---|---|
| `FAST_UPDATE_TOKEN` | (required) | Bearer token for the fast-update-server |
| `AUTO_UPDATE_SERVER_URL` | `http://rxpc.gz.cvte.cn/fast-update-server` | Server base URL (use HTTP — HTTPS cert has SSL errors) |
| `AUTO_UPDATE_PRODUCT_ID` | `work-agents` | Product ID on server |
| `AUTO_UPDATE_CHANNEL` | `stable` | Channel to publish to |
| `GITHUB_REPO` | `xukunfeng0496/work-agents` | GitHub repository (`owner/repo`) |
| `GITHUB_TOKEN` | (optional) | GitHub token for private repos or higher rate limits |

## Steps

### 1. Resolve version

- If `$ARGUMENTS` is provided, use it as the version
- Otherwise read from `apps/electron/package.json`
- The GitHub release tag will be `v{version}`

### 2. Check env

- Verify `FAST_UPDATE_TOKEN` is set; if not, stop and tell the user
- Read the other env vars, using defaults if not set

### 3. Write and run the sync script

Write a Bun TypeScript script to `/tmp/sync-fast-update-{version}.ts` and run it with `bun run`.

The script should:

```typescript
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const version = process.env.VERSION!
const serverUrl = (process.env.AUTO_UPDATE_SERVER_URL || 'https://rxpc.gz.cvte.cn/fast-update-server').replace(/\/+$/, '')
const productId = process.env.AUTO_UPDATE_PRODUCT_ID || 'work-agents'
const channel = process.env.AUTO_UPDATE_CHANNEL || 'stable'
const token = process.env.FAST_UPDATE_TOKEN!
const githubRepo = process.env.GITHUB_REPO || 'litchi-ai/work-agents'
const githubToken = process.env.GITHUB_TOKEN || ''

const tmpDir = join(tmpdir(), `fast-update-sync-${version}`)
mkdirSync(tmpDir, { recursive: true })
```

#### Asset classification

Use the same logic as `scripts/upload-fast-update-release.ts` to classify files:

```typescript
type UploadTarget = {
  fileName: string
  os?: 'darwin' | 'windows' | 'linux'
  arch?: 'x64' | 'arm64'
  setLatest: boolean
  priority: number  // lower = upload first (blockmaps before main files for delta)
}

function classifyAsset(fileName: string): UploadTarget | null {
  // latest.yml files — upload without os/arch/set_latest
  if (fileName === 'latest.yml' || fileName === 'latest-mac.yml' || fileName === 'latest-linux.yml') {
    return { fileName, setLatest: false, priority: 30 }
  }

  // Only upload artifacts that contain the version string
  if (!fileName.includes(version)) return null

  if (fileName.includes('-osx-arm64')) {
    return { fileName, os: 'darwin', arch: 'arm64',
      setLatest: fileName.endsWith('.zip') || fileName.endsWith('.dmg'),
      priority: fileName.endsWith('.blockmap') ? 20 : 10 }
  }
  if (fileName.includes('-osx-x64')) {
    return { fileName, os: 'darwin', arch: 'x64',
      setLatest: fileName.endsWith('.zip') || fileName.endsWith('.dmg'),
      priority: fileName.endsWith('.blockmap') ? 20 : 10 }
  }
  if (fileName.includes('-windows-x64')) {
    return { fileName, os: 'windows', arch: 'x64',
      setLatest: fileName.endsWith('.exe'),
      priority: fileName.endsWith('.blockmap') ? 20 : 10 }
  }
  if (fileName.includes('-linux-x64')) {
    return { fileName, os: 'linux', arch: 'x64',
      setLatest: fileName.endsWith('.AppImage'),
      priority: fileName.endsWith('.blockmap') ? 20 : 10 }
  }
  return null
}
```

#### Fetch release assets from GitHub

```typescript
async function fetchReleaseAssets(): Promise<{ name: string; url: string; size: number }[]> {
  const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/tags/v${version}`
  const headers: Record<string, string> = { 'User-Agent': 'fast-update-sync', Accept: 'application/vnd.github+json' }
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`

  const res = await fetch(apiUrl, { headers })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`)

  const release = await res.json() as { assets: { name: string; browser_download_url: string; size: number }[] }
  return release.assets.map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }))
}
```

#### Download a file

```typescript
async function downloadAsset(url: string, destPath: string, headers?: Record<string, string>): Promise<void> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  await Bun.write(destPath, res)
}
```

#### Upload to fast-update-server

Same pattern as the existing `scripts/upload-fast-update-release.ts`.

#### Upload changelog

Fetch `apps/electron/RELEASE_NOTES.md` from the GitHub release body or from the local file if present. If neither, skip.

Actually: read `apps/electron/RELEASE_NOTES.md` from the **local repo** (it's committed before the release). Upload it via `POST /api/v1/{product}/changelog/{channel}/{version}`.

#### Main function

```typescript
async function main() {
  console.log(`Syncing v${version} → ${serverUrl} (${productId}/${channel})`)

  const assets = await fetchReleaseAssets()
  console.log(`Found ${assets.length} assets on GitHub release v${version}`)

  const targets = assets
    .map(a => ({ ...classifyAsset(a.name), url: a.url }))
    .filter((t): t is UploadTarget & { url: string } => t !== null && 'url' in t)
    .sort((a, b) => a.priority - b.priority || a.fileName.localeCompare(b.fileName))

  if (targets.length === 0) throw new Error('No matching artifacts found in GitHub release')

  console.log(`Uploading ${targets.length} artifact(s)...`)

  for (const target of targets) {
    const destPath = join(tmpDir, target.fileName)
    process.stdout.write(`  Downloading ${target.fileName}...`)
    const dlHeaders: Record<string, string> = {}
    if (githubToken) dlHeaders['Authorization'] = `Bearer ${githubToken}`
    await downloadAsset(target.url, destPath, dlHeaders)
    console.log(' done')

    process.stdout.write(`  Uploading ${target.fileName}...`)
    await uploadFile(target, destPath)
    console.log(' done')
  }

  await uploadChangelog()
  console.log('Sync complete.')
}
```

### 4. Run the script

Run with all required env vars:

```bash
VERSION=<version> \
  AUTO_UPDATE_SERVER_URL=<url> \
  AUTO_UPDATE_PRODUCT_ID=<product> \
  AUTO_UPDATE_CHANNEL=<channel> \
  FAST_UPDATE_TOKEN=<token> \
  GITHUB_REPO=<repo> \
  GITHUB_TOKEN=<token_if_set> \
  bun run /tmp/sync-fast-update-<version>.ts
```

Print real-time output as it runs (stream stdout/stderr).

### 5. Summary

On success, print:

```
Synced v{version} to fast-update-server
  Server:   {serverUrl}
  Product:  {productId}/{channel}
  Repo:     https://github.com/{githubRepo}/releases/tag/v{version}
```

On failure, show the error and suggest:
- Check `FAST_UPDATE_TOKEN` is valid and has uploader role
- Verify the GitHub release `v{version}` exists and has artifacts
- Check server reachability: `curl {serverUrl}/health`

## Important notes

- This command syncs FROM GitHub — CI must have already completed and created the GitHub Release before running this.
- The script downloads to macOS `$TMPDIR/fast-update-sync-{version}/` and does NOT clean up automatically (useful for debugging). Re-running will use cached files and skip re-downloading.
- **Use HTTP, not HTTPS** — the server's HTTPS cert has SSL errors (`SSL_ERROR_SYSCALL`). Always use `http://` for `AUTO_UPDATE_SERVER_URL`.
- **Large files must use curl for upload** — Bun's `fetch()` triggers nginx's `client_max_body_size` limit for files >~10MB. Use `spawnSync('curl', [...])` for files larger than 50MB.
- The existing `bun run fast-update:upload` uploads from the LOCAL `apps/electron/release/` directory. This command syncs from GitHub, which is useful after CI has already built and released.
