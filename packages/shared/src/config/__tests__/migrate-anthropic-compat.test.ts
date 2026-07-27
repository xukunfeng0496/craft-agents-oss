import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

// migrateLegacyProviderTypes' anthropic_compat branch is host-gated (CVTE D8):
// only connections pointing at the enterprise gateway host stay on the Claude
// Agent SDK route (anthropic + api_key); every other anthropic_compat
// connection (e.g. a user's own third-party Anthropic-compatible relay) must
// fall through to the upstream mapping (pi_compat + customEndpoint), keeping
// customEndpoint/capabilities/api_key_with_endpoint intact.
const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

const ENTERPRISE_GATEWAY_BASE_URL = 'https://token.cvte.com'
const THIRD_PARTY_BASE_URL = 'https://relay.example.com'

function setupConfigDir(connection: Record<string, unknown>) {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-anthropic-compat-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-config-1',
      name: 'My Workspace',
      slug: 'my-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  )

  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      llmConnections: [connection],
    }, null, 2),
    'utf-8',
  )

  // config-defaults.json carries the enterprise gateway identity so
  // isEnterpriseGatewayHost() can resolve `token.cvte.com` as the gateway host.
  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: 'test',
      description: 'test defaults',
      defaults: {
        notificationsEnabled: true,
        colorTheme: 'default',
        autoCapitalisation: true,
        sendMessageKey: 'enter',
        spellCheck: false,
        keepAwakeWhileRunning: false,
        richToolDescriptions: true,
      },
      workspaceDefaults: {
        thinkingLevel: 'off',
        permissionMode: 'ask',
        cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
        localMcpServers: { enabled: true },
      },
      enterprise: {
        defaultLlmConnection: {
          slug: 'cvte-gateway',
          name: 'CVTE Gateway',
          baseUrl: ENTERPRISE_GATEWAY_BASE_URL,
          defaultModel: 'CVTE-AUTO',
          models: ['CVTE-AUTO'],
        },
      },
    }, null, 2),
    'utf-8',
  )

  return { configDir, configPath }
}

function runMigration(configDir: string): void {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { migrateLegacyLlmConnectionsConfig } from '${STORAGE_MODULE_PATH}'; migrateLegacyLlmConnectionsConfig();`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }
}

describe('migrateLegacyProviderTypes: anthropic_compat host gate', () => {
  it('enterprise gateway host → anthropic + api_key (CVTE D8)', () => {
    const { configDir, configPath } = setupConfigDir({
      slug: 'my-gateway-conn',
      name: 'My Gateway',
      providerType: 'anthropic_compat',
      authType: 'api_key_with_endpoint',
      baseUrl: ENTERPRISE_GATEWAY_BASE_URL,
      models: ['CVTE-AUTO'],
      capabilities: { foo: 'bar' },
      codexPath: '/legacy/path',
    })

    runMigration(configDir)

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const connection = config.llmConnections[0]
    expect(connection.providerType).toBe('anthropic')
    expect(connection.authType).toBe('api_key')
    expect(connection.baseUrl).toBe(ENTERPRISE_GATEWAY_BASE_URL)
    expect(connection.capabilities).toBeUndefined()
    expect(connection.codexPath).toBeUndefined()
  })

  it('third-party host → upstream pi_compat + customEndpoint (capabilities preserved)', () => {
    const { configDir, configPath } = setupConfigDir({
      slug: 'my-relay-conn',
      name: 'My Relay',
      providerType: 'anthropic_compat',
      authType: 'api_key_with_endpoint',
      baseUrl: THIRD_PARTY_BASE_URL,
      models: ['some-model'],
      capabilities: { 'some-model': { supportsImages: false } },
    })

    runMigration(configDir)

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const connection = config.llmConnections[0]
    expect(connection.providerType).toBe('pi_compat')
    expect(connection.authType).toBe('api_key_with_endpoint')
    expect(connection.baseUrl).toBe(THIRD_PARTY_BASE_URL)
    expect(connection.customEndpoint).toEqual({ api: 'anthropic-messages' })
    expect(connection.capabilities).toEqual({ 'some-model': { supportsImages: false } })
  })
})
