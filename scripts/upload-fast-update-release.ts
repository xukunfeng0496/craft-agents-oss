/**
 * Upload release artifacts to the CVTE fast-update-server.
 *
 * Artifact naming follows the v0.10.3 electron-builder config:
 *   Craft-Agents-arm64.{dmg,zip}  → darwin/arm64
 *   Craft-Agents-x64.{dmg,zip}    → darwin/x64 — SKIPPED (D4: Intel frozen at v0.7.1)
 *   Craft-Agents-x64.exe          → windows/x64
 *   Craft-Agents-{arch}.AppImage  → linux/{arch}
 *   latest*.yml                   → update manifests
 *
 * Env: AUTO_UPDATE_SERVER_URL, AUTO_UPDATE_PRODUCT_ID, AUTO_UPDATE_CHANNEL, FAST_UPDATE_TOKEN
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

type UploadTarget = {
  fileName: string
  os?: 'darwin' | 'windows' | 'linux'
  arch?: 'x64' | 'arm64'
  setLatest: boolean
  priority: number
}

const ROOT_DIR = join(import.meta.dir, '..')
const RELEASE_DIR = join(ROOT_DIR, 'apps/electron/release')
const RELEASE_NOTES_PATH = join(ROOT_DIR, 'apps/electron/RELEASE_NOTES.md')
const ELECTRON_PACKAGE_JSON = join(ROOT_DIR, 'apps/electron/package.json')

const serverUrl = (process.env.AUTO_UPDATE_SERVER_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '')
const productId = process.env.AUTO_UPDATE_PRODUCT_ID || 'work-agents'
const channel = process.env.AUTO_UPDATE_CHANNEL || 'stable'
const token = process.env.FAST_UPDATE_TOKEN || ''

if (!token) {
  throw new Error('FAST_UPDATE_TOKEN is required')
}

if (!existsSync(RELEASE_DIR)) {
  throw new Error(`Release directory not found: ${RELEASE_DIR}`)
}

const { version } = JSON.parse(readFileSync(ELECTRON_PACKAGE_JSON, 'utf8')) as { version: string }

function getUploadTarget(fileName: string): UploadTarget | null {
  if (fileName === 'latest.yml' || fileName === 'latest-mac.yml' || fileName === 'latest-linux.yml') {
    return { fileName, setLatest: false, priority: 30 }
  }

  const isBlockmap = fileName.endsWith('.blockmap')

  // macOS arm64 — the only mac target we ship (D4: darwin-x64 frozen, never uploaded)
  if (/^Craft-Agents-arm64\.(dmg|zip)(\.blockmap)?$/.test(fileName)) {
    return {
      fileName,
      os: 'darwin',
      arch: 'arm64',
      setLatest: !isBlockmap,
      priority: isBlockmap ? 20 : 10,
    }
  }

  // macOS x64 artifacts may exist locally (electron-builder default targets) — skip
  if (/^Craft-Agents-x64\.(dmg|zip)(\.blockmap)?$/.test(fileName)) {
    console.log(`Skipping ${fileName} (darwin-x64 frozen per D4)`)
    return null
  }

  // Windows x64 NSIS installer
  if (/^Craft-Agents-x64\.exe(\.blockmap)?$/.test(fileName)) {
    return {
      fileName,
      os: 'windows',
      arch: 'x64',
      setLatest: !isBlockmap,
      priority: isBlockmap ? 20 : 10,
    }
  }

  // Linux AppImage
  const linuxMatch = fileName.match(/^Craft-Agents-(arm64|x64)\.AppImage(\.blockmap)?$/)
  if (linuxMatch) {
    return {
      fileName,
      os: 'linux',
      arch: linuxMatch[1] as 'x64' | 'arm64',
      setLatest: !isBlockmap,
      priority: isBlockmap ? 20 : 10,
    }
  }

  return null
}

async function uploadFile(target: UploadTarget): Promise<void> {
  const filePath = join(RELEASE_DIR, target.fileName)
  const form = new FormData()
  form.append('file', Bun.file(filePath), target.fileName)
  form.append('version', version)

  if (target.setLatest && target.os && target.arch) {
    form.append('os', target.os)
    form.append('arch', target.arch)
    form.append('set_latest', 'true')
  }

  const response = await fetch(`${serverUrl}/api/v1/${productId}/releases/${channel}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Upload failed for ${target.fileName}: ${response.status} ${body}`)
  }

  console.log(`Uploaded ${target.fileName}`)
}

async function uploadChangelog(): Promise<void> {
  if (!existsSync(RELEASE_NOTES_PATH)) {
    console.log('Skipping changelog upload: apps/electron/RELEASE_NOTES.md not found')
    return
  }

  const content = readFileSync(RELEASE_NOTES_PATH, 'utf8')
  const response = await fetch(`${serverUrl}/api/v1/${productId}/changelog/${channel}/${version}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: content,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Changelog upload failed: ${response.status} ${body}`)
  }

  console.log(`Uploaded changelog for ${version}`)
}

async function main(): Promise<void> {
  const targets = readdirSync(RELEASE_DIR)
    .map(getUploadTarget)
    .filter((target): target is UploadTarget => target !== null)
    .sort((a, b) => a.priority - b.priority || a.fileName.localeCompare(b.fileName))

  if (targets.length === 0) {
    throw new Error(`No release artifacts found for version ${version} in ${RELEASE_DIR}`)
  }

  console.log(`Uploading ${targets.length} artifact(s) to ${serverUrl} for ${productId}/${channel} v${version}`)

  for (const target of targets) {
    await uploadFile(target)
  }

  await uploadChangelog()
  console.log('Fast update upload complete')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
