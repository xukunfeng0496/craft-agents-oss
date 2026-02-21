/**
 * AiSettingsPage
 *
 * Unified AI settings page that consolidates all LLM-related configuration:
 * - Default connection, model, and thinking level
 * - Per-workspace overrides
 * - Connection management (add/edit/delete)
 *
 * Follows the Appearance settings pattern: app-level defaults + workspace overrides.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X, MoreHorizontal, Pencil, Trash2, Star, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, RefreshCcw } from 'lucide-react'
import type { CredentialHealthStatus, CredentialHealthIssue } from '../../../shared/types'
import { Spinner, FullscreenOverlayBase } from '@work-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import { motion, AnimatePresence } from 'motion/react'
import type { LlmConnectionWithStatus, ThinkingLevel, WorkspaceSettings, Workspace } from '../../../shared/types'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@work-agent/shared/agent/thinking-levels'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { ModelSelector, type PresetModel } from '@/components/settings/ModelSelector'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useWorkspaceIcon } from '@/hooks/useWorkspaceIcon'
import { OnboardingWizard } from '@/components/onboarding'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { getModelDisplayName, type ModelDefinition } from '@config/models'
import { getModelsForProviderType } from '@config/llm-connections'

/**
 * Derive model dropdown options from a connection's models array,
 * falling back to registry models for the connection's provider type.
 */
function getModelOptionsForConnection(
  connection: LlmConnectionWithStatus | undefined,
): Array<{ value: string; label: string; description: string }> {
  if (!connection) return []

  // If connection has explicit models, use those
  if (connection.models && connection.models.length > 0) {
    return connection.models.map((m) => {
      if (typeof m === 'string') {
        return { value: m, label: getModelDisplayName(m), description: '' }
      }
      // ModelDefinition object
      const def = m as ModelDefinition
      return { value: def.id, label: def.name, description: def.description }
    })
  }

  // Fall back to registry models for this provider type
  const registryModels = getModelsForProviderType(connection.providerType)
  return registryModels.map((m) => ({
    value: m.id,
    label: m.name,
    description: m.description,
  }))
}

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

// ============================================
// Credential Health Warning Banner
// ============================================

interface CredentialHealthBannerProps {
  issues: CredentialHealthIssue[]
  onReauthenticate: () => void
}

function CredentialHealthBanner({ issues, onReauthenticate }: CredentialHealthBannerProps) {
  const { t } = useTranslation(['settings'])

  if (issues.length === 0) return null

  const getHealthIssueMessage = (issue: CredentialHealthIssue): string => {
    switch (issue.type) {
      case 'file_corrupted':
        return t('settings:ai.credentialHealth.fileCorrupted')
      case 'decryption_failed':
        return t('settings:ai.credentialHealth.decryptionFailed')
      case 'no_default_credentials':
        return t('settings:ai.credentialHealth.noDefaultCredentials')
      default:
        return issue.message || t('settings:ai.credentialHealth.generic')
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('settings:ai.credentialHealth.title')}
          </h4>
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-300/80">
            {getHealthIssueMessage(issues[0])}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReauthenticate}
          className="flex-shrink-0 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
        >
          {t('settings:ai.credentialHealth.reauthenticate')}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Connection Row Component
// ============================================

type ValidationState = 'idle' | 'validating' | 'success' | 'error'

interface ConnectionRowProps {
  connection: LlmConnectionWithStatus
  isLastConnection: boolean
  onRenameClick: () => void
  onDelete: () => void
  onSetDefault: () => void
  onValidate: () => void
  onReauthenticate: () => void
  validationState: ValidationState
  validationError?: string
}

function ConnectionRow({ connection, isLastConnection, onRenameClick, onDelete, onSetDefault, onValidate, onReauthenticate, validationState, validationError }: ConnectionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useTranslation(['settings'])

  // Build description with provider, default indicator, auth status, and validation state
  const getDescription = () => {
    // Show validation state if not idle
    if (validationState === 'validating') return t('settings:ai.connection.validating')
    if (validationState === 'success') return t('settings:ai.connection.valid')
    if (validationState === 'error') return validationError || t('settings:ai.connection.validationFailed')

    const parts: string[] = []

    // Provider type (fall back to legacy 'type' field if providerType missing)
    // OAuth = subscription (Pro/Plus/Max), API key = API
    const provider = connection.providerType || connection.type
    const isSubscription = connection.authType === 'oauth'
    switch (provider) {
      case 'anthropic': parts.push(isSubscription ? t('settings:ai.connection.providers.anthropicSubscription') : t('settings:ai.connection.providers.anthropicApi')); break
      case 'anthropic_compat': parts.push(t('settings:ai.connection.providers.anthropicCompat')); break
      case 'openai': parts.push(isSubscription ? t('settings:ai.connection.providers.openaiSubscription') : t('settings:ai.connection.providers.openaiApi')); break
      case 'copilot': parts.push(t('settings:ai.connection.providers.copilot')); break
      case 'openai_compat': parts.push(t('settings:ai.connection.providers.openaiCompat')); break
      case 'bedrock': parts.push(t('settings:ai.connection.providers.bedrock')); break
      case 'vertex': parts.push(t('settings:ai.connection.providers.vertex')); break
      default: parts.push(provider || t('settings:ai.connection.providers.unknown'))
    }

    // Base URL for API key connections (show custom endpoint or default for provider)
    if (connection.authType !== 'oauth') {
      let endpoint = connection.baseUrl
      // Use default endpoints for standard providers if no custom baseUrl
      if (!endpoint) {
        if (provider === 'anthropic') endpoint = 'https://api.anthropic.com'
        else if (provider === 'openai') endpoint = 'https://api.openai.com'
      }
      if (endpoint) {
        // Extract hostname from URL for cleaner display
        try {
          const url = new URL(endpoint)
          parts.push(url.host)
        } catch {
          parts.push(endpoint)
        }
      }
    }

    // Auth status
    if (!connection.isAuthenticated) parts.push(t('settings:ai.connection.notAuthenticated'))

    return parts.join(' · ')
  }

  return (
    <SettingsRow
      label={(
        <div className="flex items-center gap-1">
          <ConnectionIcon connection={connection} size={14} />
          <span>{connection.name}</span>
          {connection.isDefault && (
            <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-[4px] bg-background shadow-minimal text-foreground/60">
              {t('settings:ai.connection.default')}
            </span>
          )}
        </div>
      )}
      description={getDescription()}
    >
      <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05] transition-colors"
            data-state={menuOpen ? 'open' : 'closed'}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={onRenameClick}>
            <Pencil className="h-3.5 w-3.5" />
            <span>{t('settings:ai.connection.rename')}</span>
          </StyledDropdownMenuItem>
          {!connection.isDefault && (
            <StyledDropdownMenuItem onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              <span>{t('settings:ai.connection.setAsDefault')}</span>
            </StyledDropdownMenuItem>
          )}
          <StyledDropdownMenuItem
            onClick={onReauthenticate}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            <span>{t('settings:ai.connection.reauthenticate')}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem
            onClick={onValidate}
            disabled={validationState === 'validating'}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('settings:ai.connection.validateConnection')}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={onDelete}
            variant="destructive"
            disabled={isLastConnection}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('settings:ai.connection.delete')}</span>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  )
}

// ============================================
// Workspace Override Card Component
// ============================================

interface WorkspaceOverrideCardProps {
  workspace: Workspace
  llmConnections: LlmConnectionWithStatus[]
  onSettingsChange: () => void
}

function WorkspaceOverrideCard({ workspace, llmConnections, onSettingsChange }: WorkspaceOverrideCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { t } = useTranslation(['settings'])

  // Fetch workspace icon as data URL (file:// URLs don't work in renderer)
  const iconUrl = useWorkspaceIcon(workspace)

  // Load workspace settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      setIsLoading(true)
      try {
        const ws = await window.electronAPI.getWorkspaceSettings(workspace.id)
        setSettings(ws)
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [workspace.id])

  // Save workspace setting helper
  const updateSetting = useCallback(async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.updateWorkspaceSetting(workspace.id, key, value)
      setSettings(prev => prev ? { ...prev, [key]: value } : null)
      onSettingsChange()
    } catch (error) {
      console.error(`Failed to save ${key}:`, error)
    }
  }, [workspace.id, onSettingsChange])

  const handleConnectionChange = useCallback((slug: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('defaultLlmConnection', slug === 'global' ? undefined : slug)
  }, [updateSetting])

  const handleModelChange = useCallback((model: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('model', model === 'global' ? undefined : model)
  }, [updateSetting])

  const handleThinkingChange = useCallback((level: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('thinkingLevel', level === 'global' ? undefined : level as ThinkingLevel)
  }, [updateSetting])

  // Determine if workspace has any overrides
  const hasOverrides = settings && (
    settings.defaultLlmConnection ||
    settings.model ||
    settings.thinkingLevel
  )

  // Get display values
  const currentConnection = settings?.defaultLlmConnection || 'global'
  const currentModel = settings?.model || 'global'
  const currentThinking = settings?.thinkingLevel || 'global'

  // Derive workspace's effective connection (override or default)
  const workspaceEffectiveConnection = useMemo(() => {
    const connSlug = settings?.defaultLlmConnection
    return connSlug ? llmConnections.find(c => c.slug === connSlug) : llmConnections.find(c => c.isDefault)
  }, [settings?.defaultLlmConnection, llmConnections])

  // Get summary text for collapsed state
  const getSummary = () => {
    if (!hasOverrides) return t('settings:ai.workspaceCard.usingDefaults')
    const parts: string[] = []
    if (settings?.defaultLlmConnection) {
      const conn = llmConnections.find(c => c.slug === settings.defaultLlmConnection)
      parts.push(conn?.name || settings.defaultLlmConnection)
    }
    if (settings?.model) {
      parts.push(getModelDisplayName(settings.model))
    }
    if (settings?.thinkingLevel) {
      const level = THINKING_LEVELS.find(l => l.id === settings.thinkingLevel)
      parts.push(level?.name || settings.thinkingLevel)
    }
    return parts.join(' · ')
  }

  return (
    <SettingsCard>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-foreground/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-6 h-6 rounded-full overflow-hidden bg-foreground/5 flex items-center justify-center',
              'ring-1 ring-border/50'
            )}
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-muted-foreground">
                {workspace.name?.charAt(0)?.toUpperCase() || 'W'}
              </span>
            )}
          </div>
          <div className="text-left">
            <div className="text-sm font-medium">{workspace.name}</div>
            <div className="text-xs text-muted-foreground">
              {isLoading ? t('settings:ai.workspaceCard.loading') : getSummary()}
            </div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50 px-4 py-2">
              <SettingsMenuSelectRow
                label={t('settings:ai.connection.label')}
                description={t('settings:ai.connection.description')}
                value={currentConnection}
                onValueChange={handleConnectionChange}
                options={[
                  { value: 'global', label: t('settings:ai.connection.useDefault'), description: t('settings:ai.connection.useDefaultDescription') },
                  ...llmConnections.map((conn) => ({
                    value: conn.slug,
                    label: conn.name,
                    description: conn.providerType === 'anthropic' ? 'Anthropic' :
                                 conn.providerType === 'openai' ? 'OpenAI' :
                                 conn.providerType === 'copilot' ? t('settings:ai.connection.providers.copilot') :
                                 conn.providerType || t('settings:ai.connection.providers.unknown'),
                  })),
                ]}
              />
              <SettingsMenuSelectRow
                label={t('settings:ai.model.label')}
                description={t('settings:ai.model.description')}
                value={currentModel}
                onValueChange={handleModelChange}
                options={[
                  { value: 'global', label: t('settings:ai.connection.useDefault'), description: t('settings:ai.connection.useDefaultDescription') },
                  ...getModelOptionsForConnection(workspaceEffectiveConnection),
                ]}
              />
              <SettingsMenuSelectRow
                label={t('settings:ai.thinking.label')}
                description={t('settings:ai.thinking.description')}
                value={currentThinking}
                onValueChange={handleThinkingChange}
                options={[
                  { value: 'global', label: t('settings:ai.connection.useDefault'), description: t('settings:ai.connection.useDefaultDescription') },
                  ...THINKING_LEVELS.map(({ id, name, description }) => ({
                    value: id,
                    label: name,
                    description,
                  })),
                ]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsCard>
  )
}

// ============================================
// Main Component
// ============================================

export default function AiSettingsPage() {
  const { t } = useTranslation(['settings'])
  const { llmConnections, refreshLlmConnections } = useAppShellContext()

  // API Setup overlay state
  const [showApiSetup, setShowApiSetup] = useState(false)
  const [editingConnectionSlug, setEditingConnectionSlug] = useState<string | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Workspaces for override cards
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  // Default settings state (app-level)
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)

  // Validation state per connection
  const [validationStates, setValidationStates] = useState<Record<string, {
    state: ValidationState
    error?: string
  }>>({})

  // Credential health state (for startup warning banner)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingConnection, setRenamingConnection] = useState<{ slug: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Load workspaces, default settings, and credential health
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const ws = await window.electronAPI.getWorkspaces()
        setWorkspaces(ws)

        // Check credential health for potential issues (corruption, machine migration)
        const health = await window.electronAPI.getCredentialHealth()
        if (!health.healthy) {
          setCredentialHealthIssues(health.issues)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    load()
  }, [])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback((connectionSlug?: string) => {
    setEditingConnectionSlug(connectionSlug || null)
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
    setEditingConnectionSlug(null)
  }, [setFullscreenOverlayOpen])

  // Derive existing slugs for unique slug generation
  const existingSlugs = useMemo(
    () => new Set(llmConnections.map(c => c.slug)),
    [llmConnections],
  )

  // OnboardingWizard hook for editing API connection
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    onConfigSaved: refreshLlmConnections,
    onComplete: () => {
      closeApiSetup()
      refreshLlmConnections?.()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
    editingSlug: editingConnectionSlug,
    existingSlugs,
  })

  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    refreshLlmConnections?.()
    apiSetupOnboarding.reset()
    // Clear any credential health issues after successful re-authentication
    setCredentialHealthIssues([])
  }, [closeApiSetup, refreshLlmConnections, apiSetupOnboarding])

  // Handler for closing the modal via X button or Escape - resets state and cancels OAuth
  const handleCloseApiSetup = useCallback(() => {
    closeApiSetup()
    apiSetupOnboarding.reset()
  }, [closeApiSetup, apiSetupOnboarding])

  // Handler for re-authenticate button in credential health banner
  const handleReauthenticate = useCallback(() => {
    // Open API setup for the default connection (or first connection if available)
    const defaultConn = llmConnections.find(c => c.isDefault) || llmConnections[0]
    if (defaultConn) {
      openApiSetup(defaultConn.slug)
    } else {
      openApiSetup()
    }
  }, [llmConnections, openApiSetup])

  // Connection action handlers
  const handleRenameClick = useCallback((connection: LlmConnectionWithStatus) => {
    setRenamingConnection({ slug: connection.slug, name: connection.name })
    setRenameValue(connection.name)
    // Defer dialog open to next frame to let dropdown fully unmount first
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingConnection || !window.electronAPI) return
    const trimmedName = renameValue.trim()
    if (!trimmedName || trimmedName === renamingConnection.name) {
      setRenameDialogOpen(false)
      return
    }
    try {
      // Get the full connection, update name, and save
      const connection = await window.electronAPI.getLlmConnection(renamingConnection.slug)
      if (connection) {
        const result = await window.electronAPI.saveLlmConnection({ ...connection, name: trimmedName })
        if (result.success) {
          refreshLlmConnections?.()
        } else {
          console.error('Failed to rename connection:', result.error)
        }
      }
    } catch (error) {
      console.error('Failed to rename connection:', error)
    }
    setRenameDialogOpen(false)
    setRenamingConnection(null)
    setRenameValue('')
  }, [renamingConnection, renameValue, refreshLlmConnections])

  const handleReauthenticateConnection = useCallback((connection: LlmConnectionWithStatus) => {
    openApiSetup(connection.slug)
    apiSetupOnboarding.reset()

    if (connection.authType === 'oauth') {
      const method = connection.providerType === 'openai' ? 'chatgpt_oauth'
                   : connection.providerType === 'copilot' ? 'copilot_oauth'
                   : 'claude_oauth'
      apiSetupOnboarding.handleStartOAuth(method)
    }
  }, [apiSetupOnboarding, openApiSetup])

  const handleDeleteConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.deleteLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to delete connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to delete connection:', error)
    }
  }, [refreshLlmConnections])

  const handleValidateConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return

    // Set validating state
    setValidationStates(prev => ({ ...prev, [slug]: { state: 'validating' } }))

    try {
      const result = await window.electronAPI.testLlmConnection(slug)

      if (result.success) {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'success' } }))
        // Auto-clear success state after 3 seconds
        setTimeout(() => {
          setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
        }, 3000)
      } else {
        setValidationStates(prev => ({
          ...prev,
          [slug]: { state: 'error', error: result.error }
        }))
        // Auto-clear error state after 5 seconds
        setTimeout(() => {
          setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
        }, 5000)
      }
    } catch (error) {
      setValidationStates(prev => ({
        ...prev,
        [slug]: { state: 'error', error: 'Validation failed' }
      }))
      setTimeout(() => {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
      }, 5000)
    }
  }, [])

  const handleSetDefaultConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.setDefaultLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to set default connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to set default connection:', error)
    }
  }, [refreshLlmConnections])

  // Get the default connection for display
  const defaultConnection = useMemo(() => {
    return llmConnections.find(c => c.isDefault)
  }, [llmConnections])

  const defaultModel = defaultConnection?.defaultModel ?? ''

  // Determine if default connection is a compat/custom endpoint (needs ModelSelector)
  const isCompatConnection = useMemo(() => {
    if (!defaultConnection) return false
    const { providerType, baseUrl } = defaultConnection
    return providerType === 'anthropic_compat' ||
           providerType === 'openai_compat' ||
           !!baseUrl
  }, [defaultConnection])

  // Preset models for ModelSelector
  const presetModels = useMemo((): PresetModel[] => {
    return [
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', description: t('settings:ai.model.presetClaudeSonnet') },
      { id: 'glm-5', label: 'glm-5', description: t('settings:ai.model.presetGlm') },
    ]
  }, [t])

  // Derive selected models and custom models from connection.models
  const selectedModels = useMemo(() => {
    if (!defaultConnection?.models) return new Set<string>()
    const ids = (defaultConnection.models as (string | { id: string })[])
      .map(m => typeof m === 'string' ? m : m.id)
    return new Set(ids)
  }, [defaultConnection?.models])

  const customModels = useMemo(() => {
    if (!defaultConnection?.models) return []
    const presetIds = new Set(presetModels.map(m => m.id))
    return (defaultConnection.models as (string | { id: string })[])
      .map(m => typeof m === 'string' ? m : m.id)
      .filter(id => !presetIds.has(id))
  }, [defaultConnection?.models, presetModels])

  // Handler for selected models changes (multi-select)
  const handleSelectedModelsChange = useCallback(async (models: Set<string>) => {
    if (!window.electronAPI || !defaultConnection) return
    const modelArray = Array.from(models)
    const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = defaultConnection
    // First selected model becomes the defaultModel
    const newDefault = modelArray[0] || defaultConnection.defaultModel
    await window.electronAPI.saveLlmConnection({ ...connectionData, models: modelArray, defaultModel: newDefault } as import('../../../shared/types').LlmConnection)
    await refreshLlmConnections()
  }, [defaultConnection, refreshLlmConnections])

  // Handler for custom models changes from ModelSelector
  const handleCustomModelsChange = useCallback(async (models: string[]) => {
    if (!window.electronAPI || !defaultConnection) return
    // Keep selected preset models + new custom models
    const presetIds = presetModels.map(m => m.id)
    const currentSelected = Array.from(selectedModels)
    const selectedPresets = currentSelected.filter(id => presetIds.includes(id))
    const allModels = [...selectedPresets, ...models]
    const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = defaultConnection
    await window.electronAPI.saveLlmConnection({ ...connectionData, models: allModels } as import('../../../shared/types').LlmConnection)
    await refreshLlmConnections()
  }, [defaultConnection, presetModels, selectedModels, refreshLlmConnections])

  // App-level default handlers
  const handleDefaultModelChange = useCallback(async (model: string) => {
    if (!window.electronAPI || !defaultConnection) return
    // Update defaultModel on the connection, then save the full connection
    const updated = { ...defaultConnection, defaultModel: model }
    // Remove status fields that aren't part of LlmConnection
    const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = updated
    await window.electronAPI.saveLlmConnection(connectionData as import('../../../shared/types').LlmConnection)
    await refreshLlmConnections()
  }, [defaultConnection, refreshLlmConnections])

  const handleDefaultThinkingChange = useCallback(async (level: ThinkingLevel) => {
    setDefaultThinking(level)
    // TODO: Add app-level thinking level storage
  }, [])

  // Refresh callback for workspace cards
  const handleWorkspaceSettingsChange = useCallback(() => {
    // Refresh context so changes propagate immediately
    refreshLlmConnections?.()
  }, [refreshLlmConnections])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings:ai.pageTitle')} actions={<HeaderMenu route={routes.view.settings('ai')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            {/* Credential Health Warning Banner */}
            <CredentialHealthBanner
              issues={credentialHealthIssues}
              onReauthenticate={handleReauthenticate}
            />

            <div className="space-y-8">
              {/* Default Settings - only show if connections exist */}
              {llmConnections.length > 0 && (
              <SettingsSection title={t('settings:ai.default.title')} description={t('settings:ai.default.description')}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t('settings:ai.connection.label')}
                    description={t('settings:ai.connection.description')}
                    value={defaultConnection?.slug || ''}
                    onValueChange={handleSetDefaultConnection}
                    options={llmConnections.map((conn) => ({
                      value: conn.slug,
                      label: conn.name,
                      description: conn.providerType === 'anthropic' ? t('settings:ai.connection.providers.anthropicApi') :
                                   conn.providerType === 'openai' ? t('settings:ai.connection.providers.openaiApi') :
                                   conn.providerType === 'copilot' ? t('settings:ai.connection.providers.copilot') :
                                   conn.providerType === 'openai_compat' ? t('settings:ai.connection.providers.openaiCompat') :
                                   conn.providerType === 'bedrock' ? t('settings:ai.connection.providers.bedrock') :
                                   conn.providerType === 'vertex' ? t('settings:ai.connection.providers.vertex') :
                                   conn.providerType || t('settings:ai.connection.providers.unknown'),
                    }))}
                  />
                  {isCompatConnection ? (
                    <ModelSelector
                      connectionSlug={defaultConnection?.slug || ''}
                      selectedModels={selectedModels}
                      onSelectedModelsChange={handleSelectedModelsChange}
                      presetModels={presetModels}
                      customModels={customModels}
                      onCustomModelsChange={handleCustomModelsChange}
                    />
                  ) : (
                    <SettingsMenuSelectRow
                      label={t('settings:ai.model.label')}
                      description={t('settings:ai.model.description')}
                      value={defaultModel}
                      onValueChange={handleDefaultModelChange}
                      options={getModelOptionsForConnection(defaultConnection)}
                    />
                  )}
                  <SettingsMenuSelectRow
                    label={t('settings:ai.thinking.label')}
                    description={t('settings:ai.thinking.description')}
                    value={defaultThinking}
                    onValueChange={(v) => handleDefaultThinkingChange(v as ThinkingLevel)}
                    options={THINKING_LEVELS.map(({ id, name, description }) => ({
                      value: id,
                      label: name,
                      description,
                    }))}
                  />
                </SettingsCard>
              </SettingsSection>
              )}

              {/* Workspace Overrides - only show if connections exist */}
              {workspaces.length > 0 && llmConnections.length > 0 && (
                <SettingsSection title={t('settings:ai.workspaceOverrides.title')} description={t('settings:ai.workspaceOverrides.description')}>
                  <div className="space-y-2">
                    {workspaces.map((workspace) => (
                      <WorkspaceOverrideCard
                        key={workspace.id}
                        workspace={workspace}
                        llmConnections={llmConnections}
                        onSettingsChange={handleWorkspaceSettingsChange}
                      />
                    ))}
                  </div>
                </SettingsSection>
              )}

              {/* Connections Management */}
              <SettingsSection title={t('settings:ai.connections.title')} description={t('settings:ai.connections.description')}>
                <SettingsCard>
                  {llmConnections.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('settings:ai.connections.empty')}
                    </div>
                  ) : (
                    [...llmConnections]
                      .sort((a, b) => {
                        if (a.isDefault && !b.isDefault) return -1
                        if (!a.isDefault && b.isDefault) return 1
                        return a.name.localeCompare(b.name)
                      })
                      .map((conn) => (
                      <ConnectionRow
                        key={conn.slug}
                        connection={conn}
                        isLastConnection={false}
                        onRenameClick={() => handleRenameClick(conn)}
                        onDelete={() => handleDeleteConnection(conn.slug)}
                        onSetDefault={() => handleSetDefaultConnection(conn.slug)}
                        onValidate={() => handleValidateConnection(conn.slug)}
                        onReauthenticate={() => handleReauthenticateConnection(conn)}
                        validationState={validationStates[conn.slug]?.state || 'idle'}
                        validationError={validationStates[conn.slug]?.error}
                      />
                    ))
                  )}
                </SettingsCard>
                <div className="pt-0">
                  <button
                    onClick={() => openApiSetup()}
                    className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                  >
                    {t('settings:ai.connections.addConnection')}
                  </button>
                </div>
              </SettingsSection>

              {/* API Setup Fullscreen Overlay */}
              <FullscreenOverlayBase
                isOpen={showApiSetup}
                onClose={handleCloseApiSetup}
                className="z-splash flex flex-col bg-foreground-2"
              >
                <OnboardingWizard
                  state={apiSetupOnboarding.state}
                  onContinue={apiSetupOnboarding.handleContinue}
                  onBack={apiSetupOnboarding.handleBack}
                  onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                  onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                  onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                  onFinish={handleApiSetupFinish}
                  isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                  onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                  onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                  copilotDeviceCode={apiSetupOnboarding.copilotDeviceCode}
                  className="h-full"
                />
                <div
                  className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                  style={{ zIndex: 'var(--z-fullscreen, 350)' }}
                >
                  <button
                    onClick={handleCloseApiSetup}
                    className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title="Close (Esc)"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </FullscreenOverlayBase>

              {/* Rename Connection Dialog */}
              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title={t('settings:ai.renameDialog.title')}
                value={renameValue}
                onValueChange={setRenameValue}
                onSubmit={handleRenameSubmit}
                placeholder={t('settings:ai.renameDialog.placeholder')}
              />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
