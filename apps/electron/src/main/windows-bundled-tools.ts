import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { mainLog } from './logger'

const AdmZip = require('adm-zip')

const BUNDLED_TOOLS_DIR_ENV = 'WORK_AGENT_BUNDLED_TOOLS_DIR'
const TOOLS_ARCHIVE_DIR = 'tools-archives'
const TOOLS_EXTRACT_DIR = 'bundled-tools'
const TOOLS_MANIFEST_FILE = 'manifest.json'
const EXTRACTED_MANIFEST_FILE = '.manifest.json'

type ToolArchiveEntry = {
  name: string
  file: string
  size: number
  sha256: string
}

type ToolArchiveManifest = {
  schemaVersion: number
  archives: ToolArchiveEntry[]
}

function getLegacyPackagedToolsDir(): string {
  return join(process.resourcesPath, 'tools')
}

function getPackagedToolsArchiveDir(): string {
  return join(process.resourcesPath, TOOLS_ARCHIVE_DIR)
}

function getPackagedToolsManifestPath(): string {
  return join(getPackagedToolsArchiveDir(), TOOLS_MANIFEST_FILE)
}

function getExtractedToolsDir(): string {
  return join(app.getPath('userData'), TOOLS_EXTRACT_DIR)
}

async function readManifest(manifestPath: string): Promise<ToolArchiveManifest | null> {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as ToolArchiveManifest
    if (!Array.isArray(parsed.archives)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function manifestsMatch(a: ToolArchiveManifest | null, b: ToolArchiveManifest | null): boolean {
  if (!a || !b) {
    return false
  }

  if (a.schemaVersion !== b.schemaVersion || a.archives.length !== b.archives.length) {
    return false
  }

  return a.archives.every((archive, index) => {
    const other = b.archives[index]
    return archive.name === other.name &&
      archive.file === other.file &&
      archive.size === other.size &&
      archive.sha256 === other.sha256
  })
}

function extractedToolsMatchManifest(targetDir: string, manifest: ToolArchiveManifest): boolean {
  const extractedManifestPath = join(targetDir, EXTRACTED_MANIFEST_FILE)
  if (!existsSync(extractedManifestPath)) {
    return false
  }

  return manifest.archives.every(archive => existsSync(join(targetDir, archive.name)))
}

async function extractBundledTools(archiveDir: string, targetDir: string, manifest: ToolArchiveManifest): Promise<void> {
  const parentDir = dirname(targetDir)
  const tempDir = `${targetDir}.tmp-${Date.now()}-${process.pid}`

  await rm(tempDir, { recursive: true, force: true })
  await mkdir(parentDir, { recursive: true })
  await mkdir(tempDir, { recursive: true })

  try {
    for (const archive of manifest.archives) {
      const archivePath = join(archiveDir, archive.file)
      if (!existsSync(archivePath)) {
        throw new Error(`Bundled tool archive not found: ${archivePath}`)
      }

      const zip = new AdmZip(archivePath)
      zip.extractAllTo(tempDir, true)
    }

    await writeFile(
      join(tempDir, EXTRACTED_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )

    await rm(targetDir, { recursive: true, force: true })
    await rename(tempDir, targetDir)
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

function setBundledToolsEnv(toolsDir: string): string {
  process.env[BUNDLED_TOOLS_DIR_ENV] = toolsDir
  return toolsDir
}

export async function ensureBundledWindowsToolsReady(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null
  }

  if (!app.isPackaged) {
    const devToolsDir = join(app.getAppPath(), 'resources', 'tools')
    return existsSync(devToolsDir) ? setBundledToolsEnv(devToolsDir) : null
  }

  const legacyToolsDir = getLegacyPackagedToolsDir()
  const manifestPath = getPackagedToolsManifestPath()

  if (!existsSync(manifestPath)) {
    if (existsSync(legacyToolsDir)) {
      return setBundledToolsEnv(legacyToolsDir)
    }

    mainLog.warn(`Bundled Windows tools manifest not found at ${manifestPath}`)
    return null
  }

  const packagedManifest = await readManifest(manifestPath)
  if (!packagedManifest) {
    mainLog.warn(`Bundled Windows tools manifest is invalid: ${manifestPath}`)
    return null
  }

  const extractedToolsDir = getExtractedToolsDir()
  const extractedManifest = await readManifest(join(extractedToolsDir, EXTRACTED_MANIFEST_FILE))
  const toolsReady = manifestsMatch(packagedManifest, extractedManifest) &&
    extractedToolsMatchManifest(extractedToolsDir, packagedManifest)

  if (!toolsReady) {
    const archiveDir = getPackagedToolsArchiveDir()
    mainLog.info(`Extracting bundled Windows tools to ${extractedToolsDir}`)
    await extractBundledTools(archiveDir, extractedToolsDir, packagedManifest)
  }

  return setBundledToolsEnv(extractedToolsDir)
}
