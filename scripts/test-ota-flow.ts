#!/usr/bin/env bun
/**
 * OTA flow test script
 *
 * Usage:
 *   bun run test:ota check   # Validate API contract against real server
 *   bun run test:ota mock    # Start mock fast-update-server for electron:dev testing
 */

import { parseArgs } from 'util'

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
})

const command = positionals[0] || 'check'
const serverUrl = (process.env.AUTO_UPDATE_SERVER_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '')
const productId = process.env.AUTO_UPDATE_PRODUCT_ID || 'work-agents'
const channel = process.env.AUTO_UPDATE_CHANNEL || 'stable'
const platform = `${process.platform}-${process.arch}`

// ─── check ────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

async function runCheck(): Promise<void> {
  console.log(`\nOTA contract check against ${serverUrl}`)
  console.log(`Product: ${productId}  Channel: ${channel}  Platform: ${platform}\n`)

  const results: CheckResult[] = []

  // 1. Health
  results.push(await checkHealth())

  // 2. Check API
  const checkInfo = await checkUpdateAPI()
  results.push(checkInfo.result)

  // 3. Versioned manifest (only if update available)
  if (checkInfo.version) {
    results.push(await checkVersionedManifest(checkInfo.version))
    results.push(await checkFileDownloadable(checkInfo.version, checkInfo.fileName))
  }

  // Summary
  console.log('\n─── Summary ───')
  const passed = results.filter(r => r.ok).length
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}`)
  }
  console.log(`\n${passed}/${results.length} passed`)

  if (passed < results.length) {
    process.exit(1)
  }
}

async function checkHealth(): Promise<CheckResult> {
  const name = 'Health endpoint'
  try {
    const res = await fetch(`${serverUrl}/health`)
    const data = (await res.json()) as { status?: string; products?: Array<{ id: string }> }
    if (data.status !== 'ok') {
      return { name, ok: false, detail: `status=${data.status}` }
    }
    const hasProduct = data.products?.some((p) => p.id === productId)
    if (!hasProduct) {
      return { name, ok: false, detail: `product "${productId}" not registered` }
    }
    return { name, ok: true, detail: `ok, product "${productId}" found` }
  } catch (e) {
    return { name, ok: false, detail: `unreachable: ${(e as Error).message}` }
  }
}

async function checkUpdateAPI(): Promise<{ result: CheckResult; version?: string; fileName?: string }> {
  const name = 'Check API'
  try {
    const url = new URL(`${serverUrl}/api/v1/${productId}/check/${channel}`)
    url.searchParams.set('platform', platform)
    url.searchParams.set('version', '0.0.1') // low version to trigger update

    const res = await fetch(url)
    if (!res.ok) {
      return { result: { name, ok: false, detail: `HTTP ${res.status}` } }
    }

    const data = (await res.json()) as {
      updateAvailable?: boolean
      version?: string
      sha512?: string
      size?: number
      path?: string
      files?: Array<{ url?: string; sha512?: string; size?: number }>
    }

    if (typeof data.updateAvailable !== 'boolean') {
      return { result: { name, ok: false, detail: 'missing updateAvailable field' } }
    }

    if (!data.updateAvailable) {
      return { result: { name, ok: true, detail: 'no update (server has no release for this platform)' } }
    }

    // Validate required fields when update is available
    const missing: string[] = []
    if (!data.version) missing.push('version')
    if (!data.sha512) missing.push('sha512')
    if (!data.files?.length) missing.push('files')

    if (missing.length) {
      return { result: { name, ok: false, detail: `update v${data.version} missing: ${missing.join(', ')}` } }
    }

    const fileName = data.files![0].url || data.path
    return {
      result: { name, ok: true, detail: `v${data.version} available, sha512 present, ${data.files!.length} file(s)` },
      version: data.version,
      fileName: fileName || undefined,
    }
  } catch (e) {
    return { result: { name, ok: false, detail: (e as Error).message } }
  }
}

async function checkVersionedManifest(version: string): Promise<CheckResult> {
  const name = 'Versioned latest-mac.yml'
  const manifestUrl = `${serverUrl}/api/v1/${productId}/download/${channel}/${version}/latest-mac.yml`
  try {
    const res = await fetch(manifestUrl)
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status} at ${manifestUrl}` }
    }
    const body = await res.text()
    const hasVersion = body.includes(`version: ${version}`) || body.includes(`version: '${version}'`)
    const hasSha512 = body.includes('sha512:')
    if (!hasVersion || !hasSha512) {
      return { name, ok: false, detail: `YAML missing fields (version=${hasVersion}, sha512=${hasSha512})` }
    }
    return { name, ok: true, detail: `served correctly for v${version}` }
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message }
  }
}

async function checkFileDownloadable(version: string, fileName?: string): Promise<CheckResult> {
  const name = 'File downloadable (HEAD)'
  if (!fileName) {
    return { name, ok: false, detail: 'no filename from check API' }
  }
  const fileUrl = `${serverUrl}/api/v1/${productId}/download/${channel}/${version}/${fileName}`
  try {
    const res = await fetch(fileUrl, { method: 'HEAD' })
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status}` }
    }
    const size = parseInt(res.headers.get('Content-Length') || '0', 10)
    const acceptRanges = res.headers.get('Accept-Ranges')
    return {
      name,
      ok: true,
      detail: `${fileName} (${(size / 1024 / 1024).toFixed(1)} MB, ranges=${acceptRanges || 'none'})`,
    }
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message }
  }
}

// ─── mock ─────────────────────────────────────────────────────────────────────

const MOCK_PORT = 8888
const MOCK_VERSION = '99.99.99'

// Track 429 simulation state
let rateLimitRemaining = 0

// Generate a deterministic mock file and compute its real sha512
const MOCK_FILE_SIZE = 1024
const MOCK_FILE_DATA = new Uint8Array(MOCK_FILE_SIZE)
// Fill with recognizable pattern instead of zeros
for (let i = 0; i < MOCK_FILE_SIZE; i++) MOCK_FILE_DATA[i] = i & 0xff

const MOCK_FILE_SHA512 = await (async () => {
  const hash = new Bun.CryptoHasher('sha512')
  hash.update(MOCK_FILE_DATA)
  return hash.digest('base64')
})()

function buildLatestYml(): string {
  return [
    `version: ${MOCK_VERSION}`,
    'files:',
    `  - url: mock-app-${MOCK_VERSION}.zip`,
    `    sha512: ${MOCK_FILE_SHA512}`,
    `    size: ${MOCK_FILE_SIZE}`,
    `path: mock-app-${MOCK_VERSION}.zip`,
    `sha512: ${MOCK_FILE_SHA512}`,
    `releaseDate: '${new Date().toISOString()}'`,
  ].join('\n')
}

async function startMockServer(): Promise<void> {
  console.log(`Starting mock fast-update-server on port ${MOCK_PORT}...`)
  console.log(`\nEndpoints:`)
  console.log(`  GET /api/v1/${productId}/check/${channel}           → update check`)
  console.log(`  GET /api/v1/${productId}/download/${channel}/{ver}/ → versioned manifest`)
  console.log(`  GET /health                                         → health check`)
  console.log(`\nControl:`)
  console.log(`  POST /mock/rate-limit?count=N  → next N check requests return 429`)
  console.log(`  POST /mock/error               → next check request returns 500`)

  let forceError = false

  Bun.serve({
    port: MOCK_PORT,
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // ── Control endpoints ──
      if (req.method === 'POST' && path === '/mock/rate-limit') {
        rateLimitRemaining = parseInt(url.searchParams.get('count') || '3', 10)
        return Response.json({ rateLimitRemaining })
      }
      if (req.method === 'POST' && path === '/mock/error') {
        forceError = true
        return Response.json({ forceError: true })
      }

      // ── Health ──
      if (path === '/health') {
        return Response.json({
          status: 'ok',
          server: 'mock-fast-update-server',
          products: [{ id: productId, channels: [channel] }],
        })
      }

      // ── Check API ──
      if (path === `/api/v1/${productId}/check/${channel}`) {
        if (rateLimitRemaining > 0) {
          rateLimitRemaining--
          console.log(`  → 429 rate limited (${rateLimitRemaining} remaining)`)
          return new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': '2' },
          })
        }
        if (forceError) {
          forceError = false
          console.log('  → 500 forced error')
          return new Response('internal error', { status: 500 })
        }

        const clientVersion = url.searchParams.get('version') || '0.0.0'
        const clientPlatform = url.searchParams.get('platform') || 'unknown'
        console.log(`  → check from ${clientPlatform} v${clientVersion}`)

        return Response.json({
          updateAvailable: true,
          version: MOCK_VERSION,
          releaseDate: new Date().toISOString(),
          path: `mock-app-${MOCK_VERSION}.zip`,
          sha512: MOCK_FILE_SHA512,
          size: MOCK_FILE_SIZE,
          files: [
            {
              url: `mock-app-${MOCK_VERSION}.zip`,
              sha512: MOCK_FILE_SHA512,
              size: MOCK_FILE_SIZE,
            },
          ],
        })
      }

      // ── Versioned manifest (latest-mac.yml / latest.yml / latest-linux.yml) ──
      const manifestMatch = path.match(
        new RegExp(`^/api/v1/${productId}/download/${channel}/[^/]+/(latest(?:-mac|-linux)?\\.yml)$`),
      )
      if (manifestMatch) {
        console.log(`  → serving ${manifestMatch[1]}`)
        return new Response(buildLatestYml(), {
          headers: { 'Content-Type': 'text/yaml' },
        })
      }

      // ── File download (return mock file with valid sha512) ──
      if (path.includes(`/download/${channel}/`) && (path.endsWith('.zip') || path.endsWith('.exe') || path.endsWith('.AppImage') || path.endsWith('.dmg'))) {
        console.log(`  → serving mock file (${MOCK_FILE_SIZE} bytes, sha512 matches)`)
        return new Response(MOCK_FILE_DATA, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(MOCK_FILE_SIZE),
            'Accept-Ranges': 'bytes',
          },
        })
      }

      return new Response('not found', { status: 404 })
    },
  })

  console.log(`\nMock server ready at http://localhost:${MOCK_PORT}`)
  console.log(`\nUsage:`)
  console.log(`  AUTO_UPDATE_ENABLE_DEV=1 AUTO_UPDATE_SERVER_URL=http://localhost:${MOCK_PORT} bun run electron:dev`)
  console.log(`\nTest rate limiting:`)
  console.log(`  curl -X POST http://localhost:${MOCK_PORT}/mock/rate-limit?count=3`)
  console.log(`  # next 3 check requests will return 429`)
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  switch (command) {
    case 'check':
      await runCheck()
      break
    case 'mock':
      await startMockServer()
      break
    default:
      console.log(`Unknown command: ${command}`)
      console.log('Usage:')
      console.log('  bun run test:ota check   # Validate API contract against real server')
      console.log('  bun run test:ota mock    # Start mock server for local testing')
      process.exit(1)
  }
}

void main()
