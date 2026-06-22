import { RPC_CHANNELS, type LlmConnectionSetup } from '@craft-agent/shared/protocol'
import { getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, touchLlmConnection, isCompatProvider, isAnthropicProvider, getDefaultModelsForConnection, getDefaultModelForConnection, getEnterpriseDefaults, enforceCvteGatewayShape, setCvteIdentity, replaceLlmConnection, type LlmConnection, type LlmConnectionWithStatus, toBedrockNativeId, deriveBedrockRegionPrefix } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { setSetupDeferred } from '@craft-agent/shared/config/storage'
import {
  resolveSetupTestConnectionHint,
  testBackendConnection,
  validateStoredBackendConnection,
} from '@craft-agent/shared/agent/backend'
import { getModelRefreshService } from '@craft-agent/server-core/model-fetchers'
import { parseTestConnectionError, createBuiltInConnection, validateModelList, piAuthProviderDisplayName, validateSetupTestInput, setupTestRequiresApiKey, resolveCustomEndpointSetup } from '@craft-agent/server-core/domain'
import { getWorkspaceOrThrow, buildBackendHostRuntimeContext } from '@craft-agent/server-core/handlers'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { randomUUID } from 'node:crypto'
import { CLIENT_OPEN_EXTERNAL } from '@craft-agent/server-core/transport'

// Local OAuth state
let copilotOAuthAbort: AbortController | null = null

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.llmConnections.LIST,
  RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,
  RPC_CHANNELS.llmConnections.GET,
  RPC_CHANNELS.llmConnections.GET_API_KEY,
  RPC_CHANNELS.llmConnections.SAVE,
  RPC_CHANNELS.llmConnections.DELETE,
  RPC_CHANNELS.llmConnections.TEST,
  RPC_CHANNELS.llmConnections.SET_DEFAULT,
  RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT,
  RPC_CHANNELS.llmConnections.REFRESH_MODELS,
  RPC_CHANNELS.chatgpt.START_OAUTH,
  RPC_CHANNELS.chatgpt.COMPLETE_OAUTH,
  RPC_CHANNELS.chatgpt.CANCEL_OAUTH,
  RPC_CHANNELS.chatgpt.GET_AUTH_STATUS,
  RPC_CHANNELS.chatgpt.LOGOUT,
  RPC_CHANNELS.cvte.IS_AVAILABLE,
  RPC_CHANNELS.cvte.START_OAUTH,
  RPC_CHANNELS.cvte.COMPLETE_OAUTH,
  RPC_CHANNELS.cvte.CANCEL_OAUTH,
  RPC_CHANNELS.copilot.START_OAUTH,
  RPC_CHANNELS.copilot.CANCEL_OAUTH,
  RPC_CHANNELS.copilot.GET_AUTH_STATUS,
  RPC_CHANNELS.copilot.LOGOUT,
  RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
  RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS,
  RPC_CHANNELS.pi.GET_PROVIDER_BASE_URL,
  RPC_CHANNELS.pi.GET_PROVIDER_MODELS,
] as const

export function registerLlmConnectionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps

  // Core LLM-connection setup logic. Shared by the SETUP_LLM_CONNECTION RPC and
  // the CVTE portal SSO flow (cvte:completeOAuth) so both materialize the
  // connection, enforce the gateway invariant, persist the credential, refresh
  // models and reinitialize auth through one tested path.
  async function applyLlmConnectionSetup(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> {
    try {
      const manager = getCredentialManager()

      // Ensure connection exists in config
      let connection = getLlmConnection(setup.slug)
      let isNewConnection = false
      if (!connection) {
        // Reauth guard: if updateOnly is set, the connection must already exist.
        // Clean up any orphaned credentials from a preceding OAuth flow.
        if (setup.updateOnly) {
          await manager.deleteLlmCredentials(setup.slug).catch(() => {})
          deps.platform.logger?.warn(`[SETUP_LLM_CONNECTION] updateOnly rejected for missing slug: ${setup.slug}`)
          return { success: false, error: 'Connection not found. Cannot re-authenticate a non-existent connection.' }
        }
        // Create connection with appropriate defaults based on slug
        connection = createBuiltInConnection(setup.slug, setup.baseUrl)
        isNewConnection = true
      }

      const updates: Partial<LlmConnection> = {}
      const hasConfiguredBaseUrl = !!setup.baseUrl?.trim()

      // CVTE D8: any connection pointing at the enterprise gateway host (not just
      // the provisioned slug — migrated legacy connections keep their own slug)
      // stays on the Claude Agent SDK route instead of pi_compat. Used by both
      // the baseUrl branch and the customEndpoint branch below.
      const entConn = getEnterpriseDefaults()?.defaultLlmConnection
      const hostOf = (u?: string): string | null => { try { return u ? new URL(u).host : null } catch { return null } }
      const effectiveHost = hostOf(setup.baseUrl ?? connection.baseUrl)
      const isEnterpriseGateway = !!entConn && (connection.slug === entConn.slug || (!!effectiveHost && effectiveHost === hostOf(entConn.baseUrl)))

      if (setup.baseUrl !== undefined) {
        updates.baseUrl = setup.baseUrl?.trim() || undefined

        // Only mutate providerType for API key connections (not OAuth connections)
        if (isAnthropicProvider(connection.providerType) && connection.authType !== 'oauth') {
          if (hasConfiguredBaseUrl && isEnterpriseGateway) {
            // The enterprise gateway serves the full Anthropic Messages protocol.
            updates.providerType = 'anthropic'
            updates.authType = 'api_key'
          } else if (hasConfiguredBaseUrl) {
            updates.providerType = 'pi_compat'
            updates.authType = 'api_key_with_endpoint'
            updates.customEndpoint = { api: 'anthropic-messages' }
          } else {
            updates.providerType = 'anthropic'
            updates.authType = 'api_key'
            updates.models = getDefaultModelsForConnection('anthropic')
            updates.defaultModel = getDefaultModelForConnection('anthropic')
          }
        }

        // Pi API key flow: store baseUrl on the connection (Pi SDK doesn't use it yet,
        // but it's persisted for future backend support)

      }

      if (setup.defaultModel !== undefined) {
        updates.defaultModel = setup.defaultModel ?? undefined
      }
      if (setup.models !== undefined) {
        updates.models = setup.models ?? undefined
      }
      if (setup.modelSelectionMode !== undefined) {
        updates.modelSelectionMode = setup.modelSelectionMode
      }

      // CVTE D8: the edit form's Protocol toggle submits customEndpoint for any
      // custom-baseUrl connection — for the enterprise gateway (Anthropic Messages)
      // this must NOT flip the connection onto the Pi route. Drop it here.
      const customEndpoint = hasConfiguredBaseUrl && !(isEnterpriseGateway && setup.customEndpoint?.api === 'anthropic-messages')
        ? setup.customEndpoint
        : undefined
      const isCustomEndpointCompat = !!customEndpoint
      if (customEndpoint) {
        updates.customEndpoint = customEndpoint
        updates.providerType = 'pi_compat'
        const branch = resolveCustomEndpointSetup({
          baseUrl: setup.baseUrl ?? undefined,
          credential: setup.credential ?? undefined,
          customEndpointApi: customEndpoint.api,
        })
        updates.authType = branch.authType
        if (branch.name !== undefined) updates.name = branch.name
        if (branch.piAuthProvider !== undefined) updates.piAuthProvider = branch.piAuthProvider

        // Brand-name override on first setup only (user-renamed connections aren't clobbered on re-save).
        if (isNewConnection && !updates.name && setup.baseUrl?.toLowerCase().includes('manifest.build')) {
          updates.name = 'Manifest'
        }
      } else if (setup.baseUrl !== undefined) {
        // Base URL was explicitly updated without custom protocol config.
        // Treat this as non-custom mode and clear stale custom endpoint metadata.
        // Only downgrade existing connections — new ones already have the correct
        // providerType from createBuiltInConnection().
        updates.customEndpoint = undefined
        if (connection.providerType === 'pi_compat' && connection.authType !== 'oauth' && !isNewConnection) {
          if (isEnterpriseGateway && connection.customEndpoint?.api !== 'openai-completions') {
            // CVTE D8: repair previously flipped gateway connections back onto
            // the Claude Agent SDK route instead of downgrading to plain Pi.
            // Deliberate OpenAI-protocol gateway connections are left alone.
            updates.providerType = 'anthropic'
            updates.authType = 'api_key'
          } else {
            updates.providerType = 'pi'
            updates.authType = 'api_key'
          }
        }
      }

      // Pi API key flow: set piAuthProvider from setup data (e.g. 'anthropic', 'google', 'openai').
      // Skip when custom endpoint protocol is driving routing.
      if (setup.piAuthProvider && !isCustomEndpointCompat) {
        updates.piAuthProvider = setup.piAuthProvider
        // Update connection name to show the actual provider (e.g. "Work Agents Backend (Google AI Studio)").
        // CVTE: never rename the enterprise gateway — it keeps its config-defaults name
        // ("CVTE Gateway") regardless of protocol, so it can't end up mislabeled
        // "Work Agents Backend (Anthropic)" while actually on the OpenAI shape.
        const providerName = piAuthProviderDisplayName(setup.piAuthProvider)
        if (providerName && !isEnterpriseGateway) {
          updates.name = `Work Agents Backend (${providerName})`
        }
        // Only set default models when using standard Pi provider AND user didn't pick explicit models
        if (!hasConfiguredBaseUrl && !setup.models?.length) {
          updates.models = getDefaultModelsForConnection('pi', setup.piAuthProvider)
          updates.defaultModel = getDefaultModelForConnection('pi', setup.piAuthProvider)
          updates.modelSelectionMode ??= 'automaticallySyncedFromProvider'
        }
      }

      // Pi+Bedrock auth method override — set authType for IAM or environment auth.
      // providerType stays 'pi' (Bedrock routes through Pi SDK).
      if (setup.bedrockAuthMethod) {
        updates.authType = setup.bedrockAuthMethod
      }

      // Resolved Anthropic OAuth identity (issue #838). Threaded through SETUP so
      // it persists on both the new-connection path (addLlmConnection) and the
      // re-auth path (updateLlmConnection) via the shared pendingConnection/updates
      // flow below. Fail-soft: only stamp when at least one identity block arrived.
      const oauthIdentity = setup.oauthIdentity
      if (oauthIdentity?.account || oauthIdentity?.organization) {
        // Set only fields that are actually present, so `updates` never carries an
        // explicit `undefined` (matches the guarded-assignment style used above and
        // keeps the update intent clean). Missing sub-fields are simply not touched;
        // on re-auth the storage allowlist then preserves any prior value.
        if (oauthIdentity.account?.uuid) updates.oauthAccountUuid = oauthIdentity.account.uuid
        if (oauthIdentity.account?.emailAddress) updates.oauthAccountEmail = oauthIdentity.account.emailAddress
        if (oauthIdentity.organization?.uuid) updates.oauthOrganizationUuid = oauthIdentity.organization.uuid
        if (oauthIdentity.organization?.name) updates.oauthOrganizationName = oauthIdentity.organization.name
        updates.oauthProfileVerifiedAt = Date.now()
      }

      const effectiveProviderType = updates.providerType ?? connection.providerType
      if (effectiveProviderType === 'pi') {
        const isBedrockPi = (updates.piAuthProvider ?? connection.piAuthProvider) === 'amazon-bedrock'
        // For Pi+Bedrock, normalize bare Anthropic IDs to Bedrock-native before adding pi/ prefix
        // so that resolvePiModel() can find them in the amazon-bedrock registry.
        // Use the configured AWS region to select the correct inference profile prefix (us/eu).
        const regionPrefix = isBedrockPi ? deriveBedrockRegionPrefix(setup.awsRegion) : undefined
        const toPiModelId = (id: string) => {
          const bare = id.startsWith('pi/') ? id.slice(3) : id
          const normalized = isBedrockPi ? toBedrockNativeId(bare, regionPrefix) : bare
          return `pi/${normalized}`
        }
        if (updates.models) {
          updates.models = updates.models.map(m => typeof m === 'string' ? toPiModelId(m) : { ...m, id: toPiModelId(m.id) })
        }
        if (updates.defaultModel) {
          updates.defaultModel = toPiModelId(updates.defaultModel)
        }
      }

      const pendingConnection: LlmConnection = {
        ...connection,
        ...updates,
      }

      // CVTE gateway invariant (D8): coerce a gateway connection into one of its
      // two legal shapes (Anthropic @ token.cvte.com, or OpenAI @ …/v1) as a
      // final override of whatever the branches above set. Closes the `pi`
      // downgrade hole and enforces the mandatory `/v1` for the OpenAI shape
      // (a bare host silently breaks chat). No-op for non-gateway connections.
      // Persisted via replaceLlmConnection below (the update allowlist can't
      // drop customEndpoint/piAuthProvider on the OpenAI→Anthropic transition).
      const gatewayShapeEnforced = isEnterpriseGateway && enforceCvteGatewayShape(pendingConnection)
      if (gatewayShapeEnforced) {
        // Mirror the canonical fields into `updates` so the downstream model
        // validation sees the corrected state (persist still uses pendingConnection).
        updates.providerType = pendingConnection.providerType
        updates.authType = pendingConnection.authType
        updates.baseUrl = pendingConnection.baseUrl
        updates.customEndpoint = pendingConnection.customEndpoint
        updates.models = pendingConnection.models
        updates.defaultModel = pendingConnection.defaultModel
        updates.modelSelectionMode = pendingConnection.modelSelectionMode
      }

      if (pendingConnection.providerType === 'pi') {
        const modelIds = (pendingConnection.models ?? []).map(m => typeof m === 'string' ? m : m.id)
        deps.platform.logger?.info('Pi setup pending connection snapshot', {
          slug: pendingConnection.slug,
          piAuthProvider: pendingConnection.piAuthProvider,
          modelSelectionMode: pendingConnection.modelSelectionMode,
          defaultModel: pendingConnection.defaultModel,
          modelCount: modelIds.length,
          modelsFirst5: modelIds.slice(0, 5),
          setupModelCount: setup.models?.length,
          setupDefaultModel: setup.defaultModel,
        })
      }

      if (pendingConnection.providerType === 'pi' && pendingConnection.piAuthProvider && !pendingConnection.modelSelectionMode) {
        const inferredMode = setup.models?.length
          ? 'userDefined3Tier'
          : 'automaticallySyncedFromProvider'
        pendingConnection.modelSelectionMode = inferredMode
        updates.modelSelectionMode = inferredMode
      }

      if (updates.models && updates.models.length > 0) {
        const validation = validateModelList(updates.models, pendingConnection.defaultModel)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
        if (validation.resolvedDefaultModel) {
          pendingConnection.defaultModel = validation.resolvedDefaultModel
          updates.defaultModel = validation.resolvedDefaultModel
        }
      }

      if (isCompatProvider(pendingConnection.providerType) && !pendingConnection.defaultModel) {
        return { success: false, error: 'Default model is required for compatible endpoints.' }
      }

      if (isNewConnection) {
        const added = addLlmConnection(pendingConnection)
        if (!added) {
          deps.platform.logger?.error(`Failed to persist LLM connection: ${setup.slug} (config may be inaccessible)`)
          return { success: false, error: 'Failed to save connection. Check server logs for details.' }
        }
        deps.platform.logger?.info(`Created LLM connection: ${setup.slug}`)
      } else if (gatewayShapeEnforced) {
        // Full replace so the invariant's cleared fields (customEndpoint /
        // piAuthProvider) actually drop — the update allowlist keeps them on undefined.
        const replaced = replaceLlmConnection(pendingConnection)
        if (!replaced) {
          deps.platform.logger?.error(`Failed to persist CVTE gateway connection: ${setup.slug}`)
          return { success: false, error: 'Failed to update connection. Check server logs for details.' }
        }
        deps.platform.logger?.info(`Updated CVTE gateway connection (shape enforced): ${setup.slug}`)
      } else if (Object.keys(updates).length > 0) {
        const updated = updateLlmConnection(setup.slug, updates)
        if (!updated) {
          deps.platform.logger?.error(`Failed to update LLM connection: ${setup.slug}`)
          return { success: false, error: 'Failed to update connection. Check server logs for details.' }
        }
        deps.platform.logger?.info(`Updated LLM connection settings: ${setup.slug}`)
      }

      // Store credential if provided (skip masked placeholders from GET_API_KEY)
      const isMasked = setup.credential?.includes('••')
      if (setup.credential && !isMasked) {
        const authType = pendingConnection.authType
        if (authType === 'oauth') {
          await manager.setLlmOAuth(setup.slug, { accessToken: setup.credential })
          deps.platform.logger?.info('Saved OAuth access token to LLM connection')
        } else {
          await manager.setLlmApiKey(setup.slug, setup.credential)
          deps.platform.logger?.info('Saved API key to LLM connection')
        }
      }

      // Pi+Bedrock IAM credentials — stored separately from API keys
      if (setup.iamCredentials) {
        await manager.setLlmIamCredentials(setup.slug, {
          ...setup.iamCredentials,
          region: setup.awsRegion,
        })
        deps.platform.logger?.info('Saved IAM credentials to LLM connection')
      }

      // Set as default only if no default exists yet (first connection)
      if (!getDefaultLlmConnection()) {
        setDefaultLlmConnection(setup.slug)
        deps.platform.logger?.info(`Set default LLM connection: ${setup.slug}`)
      }

      // Fetch available models before returning to the UI.
      // Always refresh for auto-synced connections (e.g. Copilot, Bedrock) — the static
      // catalog from setup is just a seed that needs replacing with live API data
      // filtered by the user's policy. For user-defined connections, only refresh
      // when no models were populated during setup.
      // Awaited so the model selector shows real available models immediately.
      const pendingModels = Array.isArray(pendingConnection.models) ? pendingConnection.models : []
      const isAutoSynced = pendingConnection.modelSelectionMode === 'automaticallySyncedFromProvider'
      if (!pendingModels.length || isAutoSynced) {
        try {
          await getModelRefreshService().refreshNow(setup.slug)
        } catch (err) {
          deps.platform.logger?.warn(`Model refresh after setup failed for ${setup.slug}: ${err instanceof Error ? err.message : err}`)
        }
      }

      // Reinitialize auth for the connection that was just created/updated,
      // not the global default (which may be a different connection).
      await sessionManager.reinitializeAuth(setup.slug)
      deps.platform.logger?.info('Reinitialized auth after LLM connection setup')

      // Clear "Setup later" flag now that user has configured a provider
      setSetupDeferred(false)

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger?.error('Failed to setup LLM connection:', message)
      return { success: false, error: message }
    }
  }

  // Unified handler for LLM connection setup (thin wrapper over the shared logic)
  server.handle(
    RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
    async (_ctx, setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> =>
      applyLlmConnectionSetup(setup),
  )

  // Unified connection test — uses the agent factory to spawn a real agent subprocess
  // and validate credentials via runMiniCompletion(). Same code path as actual chat.
  server.handle(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (_ctx, params: import('@craft-agent/shared/protocol').TestLlmConnectionParams): Promise<import('@craft-agent/shared/protocol').TestLlmConnectionResult> => {
    const { provider, apiKey, baseUrl, model, piAuthProvider, customEndpoint } = params
    const trimmedKey = apiKey?.trim() ?? ''
    // CVTE: the masked placeholder from GET_API_KEY ('sk-1234••••ab') must never
    // reach fetch headers — '•' (U+2022) is not a valid ByteString character.
    if (trimmedKey.includes('••')) {
      return { success: false, error: 'API key field still shows the masked placeholder. Leave it empty to keep the saved key, or paste a new one.' }
    }
    const allowEmptyApiKey = !setupTestRequiresApiKey(baseUrl)

    if (!trimmedKey && !allowEmptyApiKey) {
      return { success: false, error: 'API key is required' }
    }

    const setupValidation = validateSetupTestInput({ provider, baseUrl, piAuthProvider })
    if (!setupValidation.valid) {
      return { success: false, error: setupValidation.error }
    }

    const hint = resolveSetupTestConnectionHint({ provider, baseUrl, piAuthProvider, customEndpoint })
    deps.platform.logger?.info(`[testLlmConnectionSetup] Testing: provider=${provider}${piAuthProvider ? ` piAuth=${piAuthProvider}` : ''}${baseUrl ? ` baseUrl=${baseUrl}` : ''} hasCustomEndpoint=${!!customEndpoint} hintProvider=${hint.providerType}`)

    const startedAt = Date.now()
    try {
      const testModel = model || getDefaultModelForConnection(provider, piAuthProvider)
      deps.platform.logger?.info(`[testLlmConnectionSetup] Resolved model: ${testModel}`)
      const result = await testBackendConnection({
        provider,
        apiKey: trimmedKey,
        allowEmptyApiKey,
        model: testModel,
        baseUrl,
        timeoutMs: 45000,
        hostRuntime: buildBackendHostRuntimeContext(deps.platform),
        connection: hint,
      })
      const elapsed = Date.now() - startedAt

      if (!result.success) {
        deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, success=false`)
        deps.platform.logger?.info(`[testLlmConnectionSetup] Raw error: ${(result.error || '').slice(0, 1000)}`)
        return { success: false, error: parseTestConnectionError(result.error || 'Unknown error') }
      }
      deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, success=true`)
      return { success: true }
    } catch (error) {
      const elapsed = Date.now() - startedAt
      const msg = error instanceof Error ? error.message : String(error)
      deps.platform.logger?.info(`[testLlmConnectionSetup] Elapsed: ${elapsed}ms, threw: ${msg.slice(0, 1000)}`)
      return { success: false, error: parseTestConnectionError(msg) }
    }
  })

  // ============================================================
  // Pi Provider Discovery (main process only — Pi SDK can't run in renderer)
  // ============================================================

  server.handle(RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS, async () => {
    const { getPiApiKeyProviders } = await import('@craft-agent/shared/config')
    return getPiApiKeyProviders()
  })

  server.handle(RPC_CHANNELS.pi.GET_PROVIDER_BASE_URL, async (_ctx, provider: string) => {
    const { getPiProviderBaseUrl } = await import('@craft-agent/shared/config')
    return getPiProviderBaseUrl(provider)
  })

  server.handle(RPC_CHANNELS.pi.GET_PROVIDER_MODELS, async (_ctx, provider: string) => {
    const { getModels } = await import('@mariozechner/pi-ai')
    try {
      const models = getModels(provider as Parameters<typeof getModels>[0])
      const sorted = [...models].sort((a, b) => b.cost.output - a.cost.output || b.cost.input - a.cost.input)
      return {
        models: sorted.map(m => ({
          id: m.id.startsWith('pi/') ? m.id : `pi/${m.id}`,
          name: m.name,
          costInput: m.cost.input,
          costOutput: m.cost.output,
          contextWindow: m.contextWindow,
          reasoning: m.reasoning,
        })),
        totalCount: models.length,
      }
    } catch {
      return { models: [], totalCount: 0 }
    }
  })

  // ============================================================
  // LLM Connections (provider configurations)
  // ============================================================

  // List all LLM connections (includes built-in and custom)
  server.handle(RPC_CHANNELS.llmConnections.LIST, async (): Promise<LlmConnection[]> => {
    return getLlmConnections()
  })

  // List all LLM connections with authentication status
  server.handle(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS, async (): Promise<LlmConnectionWithStatus[]> => {
    const connections = getLlmConnections()
    const credentialManager = getCredentialManager()
    const defaultSlug = getDefaultLlmConnection()

    return Promise.all(connections.map(async (conn): Promise<LlmConnectionWithStatus> => {
      // Check if credentials exist for this connection
      const hasCredentials = await credentialManager.hasLlmCredentials(conn.slug, conn.authType)
      return {
        ...conn,
        isAuthenticated: conn.authType === 'none' || hasCredentials,
        isDefault: conn.slug === defaultSlug,
      }
    }))
  })

  // Get a specific LLM connection by slug
  server.handle(RPC_CHANNELS.llmConnections.GET, async (_ctx, slug: string): Promise<LlmConnection | null> => {
    return getLlmConnection(slug)
  })

  // Get stored API key for an LLM connection (masked — for edit form display only)
  server.handle(RPC_CHANNELS.llmConnections.GET_API_KEY, async (_ctx, slug: string): Promise<string | null> => {
    const manager = getCredentialManager()
    const key = await manager.getLlmApiKey(slug)
    if (!key) return null
    // Show provider prefix (first 7 chars) + last 4 chars, mask the middle
    if (key.length > 15) {
      return key.slice(0, 7) + '••••••••' + key.slice(-4)
    }
    return '••••••••'
  })

  // Save (create or update) an LLM connection
  // If connection.slug exists and is found, updates it; otherwise creates new
  server.handle(RPC_CHANNELS.llmConnections.SAVE, async (_ctx, connection: LlmConnection): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if this is an update or create
      const existing = getLlmConnection(connection.slug)
      if (existing) {
        // Update existing connection (can't change slug)
        const { slug: _slug, ...updates } = connection
        const success = updateLlmConnection(connection.slug, updates)
        if (!success) {
          return { success: false, error: 'Failed to update connection' }
        }
      } else {
        // Create new connection
        const success = addLlmConnection(connection)
        if (!success) {
          return { success: false, error: 'Connection with this slug already exists' }
        }
      }
      deps.platform.logger?.info(`LLM connection saved: ${connection.slug}`)
      // Push runtime updates (e.g. supportsImages toggle) to live sessions on
      // this connection. Detached so SAVE doesn't block on the per-session
      // 15s `update_runtime_config` timeout when subprocesses are slow or
      // wedged. SessionManager serializes the refresh with the next send via
      // its per-session mutex, and the lazy `getOrCreateAgent` refresh remains
      // the correctness backstop if the detached push fails.
      sessionManager.refreshConnectionRuntime(connection.slug).catch(error => {
        deps.platform.logger?.warn(
          `Detached runtime push failed for ${connection.slug}: ${error instanceof Error ? error.message : error}`,
        )
      })
      // Reinitialize auth if the saved connection is the current default
      // (updates env vars and summarization model override)
      const defaultSlug = getDefaultLlmConnection()
      if (defaultSlug === connection.slug) {
        await sessionManager.reinitializeAuth()
      }
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to save LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Delete an LLM connection (at least one connection must remain)
  server.handle(RPC_CHANNELS.llmConnections.DELETE, async (_ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }
      // deleteLlmConnection handles the "at least one must remain" check
      const success = deleteLlmConnection(slug)
      if (success) {
        // Stop any periodic model refresh timer for this connection
        getModelRefreshService().stopConnection(slug)
        // Also delete associated credentials
        const credentialManager = getCredentialManager()
        await credentialManager.deleteLlmCredentials(slug)
        deps.platform.logger?.info(`LLM connection deleted: ${slug}`)
      }
      return { success }
    } catch (error) {
      deps.platform.logger?.error('Failed to delete LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Test an LLM connection (validate credentials and connectivity with actual API call)
  server.handle(RPC_CHANNELS.llmConnections.TEST, async (_ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await validateStoredBackendConnection({
        slug,
        hostRuntime: buildBackendHostRuntimeContext(deps.platform),
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      touchLlmConnection(slug)

      if (result.shouldRefreshModels) {
        getModelRefreshService().refreshNow(slug).catch(err => {
          deps.platform.logger?.warn(`Model refresh failed during validation: ${err instanceof Error ? err.message : err}`)
        })
      }

      deps.platform.logger?.info(`LLM connection validated: ${slug}`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      deps.platform.logger?.info(`[LLM_CONNECTION_TEST] Error for ${slug}: ${msg.slice(0, 500)}`)
      const { parseValidationError } = await import('@craft-agent/shared/config')
      return { success: false, error: parseValidationError(msg) }
    }
  })

  // Set global default LLM connection
  server.handle(RPC_CHANNELS.llmConnections.SET_DEFAULT, async (_ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = setDefaultLlmConnection(slug)
      if (success) {
        deps.platform.logger?.info(`Global default LLM connection set to: ${slug}`)
        // Reinitialize auth so env vars and summarization model override match the new default
        await sessionManager.reinitializeAuth()
      }
      return { success, error: success ? undefined : 'Connection not found' }
    } catch (error) {
      deps.platform.logger?.error('Failed to set default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Set workspace default LLM connection
  server.handle(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, async (_ctx, workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }> => {
    try {
      const workspace = getWorkspaceOrThrow(workspaceId)

      // Validate connection exists if setting (not clearing)
      if (slug) {
        const connection = getLlmConnection(slug)
        if (!connection) {
          return { success: false, error: 'Connection not found' }
        }
      }

      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) {
        return { success: false, error: 'Failed to load workspace config' }
      }

      // Update workspace defaults
      config.defaults = config.defaults || {}
      if (slug) {
        config.defaults.defaultLlmConnection = slug
      } else {
        delete config.defaults.defaultLlmConnection
      }

      saveWorkspaceConfig(workspace.rootPath, config)
      deps.platform.logger?.info(`Workspace ${workspaceId} default LLM connection set to: ${slug}`)
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to set workspace default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Refresh available models for a connection (dynamic model discovery)
  server.handle(RPC_CHANNELS.llmConnections.REFRESH_MODELS, async (_ctx, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      await getModelRefreshService().refreshNow(slug)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger?.error(`Failed to refresh models for ${slug}: ${msg}`)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  // Server-owned: prepare + exchange happen here, browser + callback on client.
  // ============================================================

  interface PendingChatGptFlow {
    flowId: string
    state: string
    codeVerifier: string
    connectionSlug: string
    ownerClientId: string
    createdAt: number
  }
  const pendingChatGptFlows = new Map<string, PendingChatGptFlow>()
  const CHATGPT_FLOW_TTL_MS = 5 * 60 * 1000

  function cleanupExpiredChatGptFlows() {
    const now = Date.now()
    for (const [state, flow] of pendingChatGptFlows) {
      if (now - flow.createdAt > CHATGPT_FLOW_TTL_MS) {
        pendingChatGptFlows.delete(state)
      }
    }
  }

  // chatgpt:startOAuth — prepare PKCE + auth URL, store flow, return to client
  server.handle(RPC_CHANNELS.chatgpt.START_OAUTH, async (ctx, connectionSlug: string): Promise<{
    authUrl: string
    state: string
    flowId: string
  }> => {
    cleanupExpiredChatGptFlows()
    const { prepareChatGptOAuth } = await import('@craft-agent/shared/auth')

    const prepared = prepareChatGptOAuth()
    const flowId = randomUUID()

    pendingChatGptFlows.set(prepared.state, {
      flowId,
      state: prepared.state,
      codeVerifier: prepared.codeVerifier,
      connectionSlug,
      ownerClientId: ctx.clientId,
      createdAt: Date.now(),
    })

    deps.platform.logger?.info(`[ChatGPT OAuth] Flow started for ${connectionSlug} (flow=${flowId})`)
    return { authUrl: prepared.authUrl, state: prepared.state, flowId }
  })

  // chatgpt:completeOAuth — exchange code for tokens and store credentials
  server.handle(RPC_CHANNELS.chatgpt.COMPLETE_OAUTH, async (ctx, args: {
    flowId: string
    code: string
    state: string
  }): Promise<{ success: boolean; error?: string }> => {
    const { flowId, code, state } = args
    const flow = pendingChatGptFlows.get(state)

    if (!flow) throw new Error('Unknown or expired ChatGPT OAuth flow')
    if (flow.flowId !== flowId) throw new Error('Flow ID mismatch')
    if (flow.ownerClientId !== ctx.clientId) throw new Error('OAuth flow owned by different client')
    if (Date.now() - flow.createdAt > CHATGPT_FLOW_TTL_MS) {
      pendingChatGptFlows.delete(state)
      throw new Error('ChatGPT OAuth flow expired')
    }

    try {
      const { exchangeChatGptTokens } = await import('@craft-agent/shared/auth')
      const credentialManager = getCredentialManager()

      const tokens = await exchangeChatGptTokens(code, flow.codeVerifier)

      await credentialManager.setLlmOAuth(flow.connectionSlug, {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      pendingChatGptFlows.delete(state)
      deps.platform.logger?.info(`[ChatGPT OAuth] Flow complete for ${flow.connectionSlug}`)
      return { success: true }
    } catch (error) {
      pendingChatGptFlows.delete(state)
      deps.platform.logger?.error('[ChatGPT OAuth] Token exchange failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token exchange failed',
      }
    }
  })

  // Cancel ongoing ChatGPT OAuth flow
  server.handle(RPC_CHANNELS.chatgpt.CANCEL_OAUTH, async (ctx, args?: { state?: string }): Promise<{ success: boolean }> => {
    if (args?.state) {
      const flow = pendingChatGptFlows.get(args.state)
      if (flow && flow.ownerClientId === ctx.clientId) {
        pendingChatGptFlows.delete(args.state)
        deps.platform.logger?.info(`[ChatGPT OAuth] Flow cancelled for ${flow.connectionSlug}`)
      }
    }
    return { success: true }
  })

  // Get ChatGPT authentication status
  server.handle(RPC_CHANNELS.chatgpt.GET_AUTH_STATUS, async (_ctx, connectionSlug: string): Promise<{
    authenticated: boolean
    expiresAt?: number
    hasRefreshToken?: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      if (!creds) {
        return { authenticated: false }
      }

      // Check if expired (with 5-minute buffer)
      const isExpired = creds.expiresAt && Date.now() > creds.expiresAt - 5 * 60 * 1000

      return {
        authenticated: !isExpired || !!creds.refreshToken, // Can refresh if has refresh token
        expiresAt: creds.expiresAt,
        hasRefreshToken: !!creds.refreshToken,
      }
    } catch (error) {
      deps.platform.logger?.error('Failed to get ChatGPT auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from ChatGPT (clear stored tokens)
  server.handle(RPC_CHANNELS.chatgpt.LOGOUT, async (_ctx, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      deps.platform.logger?.info('ChatGPT credentials cleared')
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to clear ChatGPT credentials:', error)
      return { success: false }
    }
  })

  // ============================================================
  // CVTE 统一门户 SSO (D8 §六)
  // Server-owned portal OAuth → personal CCH key (via intranet relay) →
  // auto-configure the enterprise gateway connection. Browser + loopback
  // callback run on the client; build + exchange + relay + setup run here.
  // ============================================================

  interface PendingCvteFlow {
    flowId: string
    state: string
    redirectUri: string
    connectionSlug: string
    ownerClientId: string
    createdAt: number
  }
  const pendingCvteFlows = new Map<string, PendingCvteFlow>()
  const CVTE_FLOW_TTL_MS = 5 * 60 * 1000

  function cleanupExpiredCvteFlows() {
    const now = Date.now()
    for (const [id, flow] of pendingCvteFlows) {
      if (now - flow.createdAt > CVTE_FLOW_TTL_MS) pendingCvteFlows.delete(id)
    }
  }

  // Resolve the SSO config + target gateway connection from enterprise defaults.
  function resolveCvteSsoContext(slug?: string) {
    const ent = getEnterpriseDefaults()
    const sso = ent?.sso
    const gateway = ent?.defaultLlmConnection
    if (!sso?.portalHost || !sso?.clientId || !sso?.relayUrl) {
      throw new Error('CVTE SSO is not configured (enterprise.sso.portalHost/clientId/relayUrl missing).')
    }
    if (!gateway?.slug || !gateway?.baseUrl) {
      throw new Error('CVTE gateway connection is not configured (enterprise.defaultLlmConnection missing).')
    }
    return {
      portalHost: sso.portalHost,
      clientId: sso.clientId,
      relayUrl: sso.relayUrl,
      // Prefer the explicit slug (Settings reauth). When none is given (e.g. the
      // skills marketplace login, which just needs identity), target the user's
      // actual default connection rather than the canonical enterprise slug —
      // the provisioned connection may use a different slug (e.g. anthropic-api-2),
      // and createBuiltInConnection() would reject the unknown canonical slug.
      connectionSlug: slug || getDefaultLlmConnection() || gateway.slug,
      gatewayBaseUrl: gateway.baseUrl,
    }
  }

  // cvte:isAvailable — does this build have portal SSO configured? Drives whether
  // the renderer shows the "CVTE 门户登录" entry points. Also returns the deep link
  // the browser callback page redirects to on success, so login auto-returns to
  // (and focuses) the app instead of leaving the user on the callback tab.
  server.handle(RPC_CHANNELS.cvte.IS_AVAILABLE, async (): Promise<{ available: boolean; portalHost?: string; returnDeeplink?: string }> => {
    const sso = getEnterpriseDefaults()?.sso
    const gateway = getEnterpriseDefaults()?.defaultLlmConnection
    const available = !!sso?.portalHost && !!sso?.clientId && !!sso?.relayUrl && !!gateway?.slug && !!gateway?.baseUrl
    if (!available) return { available: false }
    const scheme = process.env.CRAFT_DEEPLINK_SCHEME || 'workagents'
    return { available: true, portalHost: sso!.portalHost, returnDeeplink: `${scheme}://settings/ai` }
  })

  // cvte:startOAuth — build the portal authorize URL, store the flow keyed by a
  // server-generated flowId (the strong anti-CSRF binding; state is defense in
  // depth). The client passed its loopback redirectUri so the port can be dynamic.
  server.handle(RPC_CHANNELS.cvte.START_OAUTH, async (ctx, args: { slug?: string; redirectUri: string }): Promise<{
    authUrl: string
    state: string
    flowId: string
    openedExternally: boolean
  }> => {
    cleanupExpiredCvteFlows()
    const { redirectUri, slug } = args
    if (!redirectUri) throw new Error('redirectUri is required to start CVTE SSO')

    const sso = resolveCvteSsoContext(slug)
    const { buildPortalAuthorizeUrl, generatePortalState } = await import('@craft-agent/shared/auth')

    const state = generatePortalState()
    const flowId = randomUUID()
    const authUrl = buildPortalAuthorizeUrl({ portalHost: sso.portalHost, clientId: sso.clientId }, redirectUri, state)

    pendingCvteFlows.set(flowId, {
      flowId,
      state,
      redirectUri,
      connectionSlug: sso.connectionSlug,
      ownerClientId: ctx.clientId,
      createdAt: Date.now(),
    })

    // Open the portal in the system browser from the MAIN process. The renderer/
    // preload shell.openExternal is gated by user activation on Windows and silently
    // no-ops after the async RPC round-trip above (the click gesture is already
    // consumed) — so the browser never opens and the loopback callback wait hangs
    // forever. Main-process openExternal has no such gating. Headless platforms leave
    // openExternal undefined → openedExternally stays false and the client opens it
    // (or a remote client handles the returned authUrl).
    let openedExternally = false
    if (deps.platform.openExternal) {
      try {
        await deps.platform.openExternal(authUrl)
        openedExternally = true
      } catch (err) {
        deps.platform.logger?.warn(
          `[CVTE SSO] main-process openExternal failed, client will open: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    deps.platform.logger?.info(`[CVTE SSO] Flow started for ${sso.connectionSlug} (flow=${flowId}, portal=${sso.portalHost}, openedExternally=${openedExternally})`)
    return { authUrl, state, flowId, openedExternally }
  })

  // cvte:completeOAuth — exchange code → access_token → relay → personal key →
  // configure the gateway connection. Returns the resolved identity for the UI.
  server.handle(RPC_CHANNELS.cvte.COMPLETE_OAUTH, async (ctx, args: {
    flowId: string
    code: string
    state?: string
  }): Promise<{ success: boolean; identity?: import('@craft-agent/shared/auth').CvtePortalIdentity; error?: string }> => {
    const { flowId, code, state } = args
    const flow = pendingCvteFlows.get(flowId)

    if (!flow) throw new Error('Unknown or expired CVTE SSO flow')
    if (flow.ownerClientId !== ctx.clientId) throw new Error('OAuth flow owned by different client')
    // CSRF: state is mandatory (RFC 6749 §4.1.2 requires the AS to echo it). The
    // flowId binding is the primary defense; strict state is defense-in-depth.
    if (!state || flow.state !== state) throw new Error('OAuth state mismatch')
    if (Date.now() - flow.createdAt > CVTE_FLOW_TTL_MS) {
      pendingCvteFlows.delete(flowId)
      throw new Error('CVTE SSO flow expired')
    }

    try {
      const sso = resolveCvteSsoContext(flow.connectionSlug)
      const { exchangePortalToken, resolvePersonalKeyViaRelay } = await import('@craft-agent/shared/auth')

      // 1) code → portal access_token (public client, no secret/PKCE)
      const tokens = await exchangePortalToken(
        { portalHost: sso.portalHost, clientId: sso.clientId },
        code,
        flow.redirectUri,
      )
      // 2) access_token → personal CCH key (relay holds the admin key server-side)
      const { apiKey, identity } = await resolvePersonalKeyViaRelay(sso.relayUrl, tokens.accessToken)

      // 2b) persist the portal identity so the skills.gz marketplace can reuse it
      // as auth headers (account/email; non-secret). Fail-soft: only when account present.
      if (identity?.account) {
        setCvteIdentity({ account: identity.account, email: identity.email })
      }

      // 3) configure the enterprise gateway connection with the personal key.
      // The gateway invariant coerces it into the Anthropic @ token.cvte.com shape.
      const result = await applyLlmConnectionSetup({
        slug: flow.connectionSlug,
        baseUrl: sso.gatewayBaseUrl,
        credential: apiKey,
      })

      pendingCvteFlows.delete(flowId)
      if (!result.success) return { success: false, error: result.error }
      deps.platform.logger?.info(`[CVTE SSO] Flow complete for ${flow.connectionSlug} (user=${identity.account ?? identity.userId ?? '?'})`)
      return { success: true, identity }
    } catch (error) {
      pendingCvteFlows.delete(flowId)
      const message = error instanceof Error ? error.message : 'CVTE SSO failed'
      deps.platform.logger?.error('[CVTE SSO] Flow failed:', message)
      return { success: false, error: message }
    }
  })

  // cvte:cancelOAuth — drop a pending flow (browser closed / user aborted)
  server.handle(RPC_CHANNELS.cvte.CANCEL_OAUTH, async (ctx, args?: { flowId?: string }): Promise<{ success: boolean }> => {
    if (args?.flowId) {
      const flow = pendingCvteFlows.get(args.flowId)
      if (flow && flow.ownerClientId === ctx.clientId) {
        pendingCvteFlows.delete(args.flowId)
        deps.platform.logger?.info(`[CVTE SSO] Flow cancelled for ${flow.connectionSlug}`)
      }
    }
    return { success: true }
  })

  // ============================================================
  // GitHub Copilot OAuth
  // ============================================================

  // Start GitHub Copilot OAuth flow (device flow via Pi SDK)
  server.handle(RPC_CHANNELS.copilot.START_OAUTH, async (ctx, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { loginGitHubCopilot } = await import('@mariozechner/pi-ai/oauth')
      const credentialManager = getCredentialManager()

      // Cancel any previous in-flight flow
      copilotOAuthAbort?.abort()
      copilotOAuthAbort = new AbortController()

      deps.platform.logger?.info(`Starting GitHub Copilot OAuth device flow for connection: ${connectionSlug}`)

      // Use Pi SDK's login flow — this handles the device code flow AND
      // the critical Copilot token exchange that determines the correct
      // API endpoint for the user's subscription tier (individual/business/enterprise).
      const credentials = await loginGitHubCopilot({
        onAuth: (url, instructions) => {
          // Extract user code from instructions (format: "Enter code: XXXX-YYYY")
          const codeMatch = instructions?.match(/:\s*(\S+)/)
          const userCode = codeMatch?.[1] ?? ''
          deps.platform.logger?.info(`[GitHub OAuth] Device code: ${userCode}`)
          pushTyped(server, RPC_CHANNELS.copilot.DEVICE_CODE, { to: 'client', clientId: ctx.clientId }, {
            userCode,
            verificationUri: url,
          })
          // Open GitHub device code page on the client's machine
          server.invokeClient(ctx.clientId, CLIENT_OPEN_EXTERNAL, url).catch(err => {
            deps.platform.logger?.warn(`Failed to open browser for GitHub OAuth: ${err}`)
          })
        },
        onPrompt: async () => {
          // Pi SDK asks for GitHub Enterprise domain — return empty for github.com
          return ''
        },
        onProgress: (message) => {
          deps.platform.logger?.info(`[GitHub OAuth] ${message}`)
        },
        signal: copilotOAuthAbort.signal,
      })

      copilotOAuthAbort = null

      // Store the full OAuth credential:
      // - accessToken = Copilot API token (contains proxy-ep for correct endpoint)
      // - refreshToken = GitHub access token (used to refresh the Copilot token)
      // - expiresAt = Copilot token expiry (short-lived, ~1 hour)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      })

      deps.platform.logger?.info('GitHub Copilot OAuth completed successfully')
      return { success: true }
    } catch (error) {
      copilotOAuthAbort = null
      deps.platform.logger?.error('GitHub Copilot OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing GitHub OAuth flow
  server.handle(RPC_CHANNELS.copilot.CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    if (copilotOAuthAbort) {
      copilotOAuthAbort.abort()
      copilotOAuthAbort = null
      deps.platform.logger?.info('GitHub Copilot OAuth cancelled')
    }
    return { success: true }
  })

  // Get GitHub Copilot authentication status
  server.handle(RPC_CHANNELS.copilot.GET_AUTH_STATUS, async (_ctx, connectionSlug: string): Promise<{
    authenticated: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      return {
        authenticated: !!creds?.accessToken,
      }
    } catch (error) {
      deps.platform.logger?.error('Failed to get GitHub auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from Copilot (clear stored tokens)
  server.handle(RPC_CHANNELS.copilot.LOGOUT, async (_ctx, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      deps.platform.logger?.info('Copilot credentials cleared')
      return { success: true }
    } catch (error) {
      deps.platform.logger?.error('Failed to clear Copilot credentials:', error)
      return { success: false }
    }
  })
}
