/**
 * SourceInfoPage
 *
 * Displays source details including connection info, authentication status,
 * documentation (guide.md), and metadata. View-only.
 */

import * as React from 'react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SourceMenu } from '@/components/app-shell/SourceMenu'
import { cn } from '@/lib/utils'
import { routes, navigate } from '@/lib/navigate'
import { useNavigation } from '@/contexts/NavigationContext'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Alert,
  Info_Markdown,
  PermissionsDataTable,
  ToolsDataTable,
  type PermissionRow,
  type ToolRow,
} from '@/components/info'
import type { LoadedSource, McpToolWithPermission } from '../../shared/types'
import type { PermissionsConfigFile } from '@work-agent/shared/agent/modes'

interface SourceInfoPageProps {
  sourceSlug: string
  workspaceId: string
  /** Optional callback when source is deleted */
  onDelete?: () => void
}

/**
 * Format timestamp to relative time using i18n
 */
function formatRelativeTime(timestamp: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!timestamp) return t('common:time.never')

  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('common:time.justNow')
  if (minutes < 60) return t('common:time.minutesAgo', { count: minutes })
  if (hours < 24) return t('common:time.hoursAgo', { count: hours })
  return t('common:time.daysAgo', { count: days })
}

/**
 * Get source URL for display
 */
function getSourceUrl(source: LoadedSource): string | null {
  const { type, mcp, api, local } = source.config

  if (type === 'mcp' && mcp?.url) return mcp.url
  if (type === 'api' && api?.baseUrl) return api.baseUrl
  if (type === 'local' && local?.path) return local.path

  return null
}

/**
 * Convert permissions config to PermissionRow[] for API/local sources
 */
function buildApiPermissionsData(config: PermissionsConfigFile): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Blocked Tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'blocked', type: 'tool', pattern, comment })
  })

  // Allowed Bash Patterns
  config.allowedBashPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'allowed', type: 'bash', pattern, comment })
  })

  // Allowed API Endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    const comment = typeof item === 'object' && 'comment' in item ? item.comment : null
    rows.push({ access: 'allowed', type: 'api', pattern, comment })
  })

  return rows
}

/**
 * Convert permissions config to PermissionRow[] for MCP sources
 */
function buildMcpPermissionsData(config: PermissionsConfigFile): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Blocked Tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'blocked', type: 'mcp', pattern, comment })
  })

  // Allowed MCP Patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'allowed', type: 'mcp', pattern, comment })
  })

  return rows
}

/**
 * Convert MCP tools to ToolRow[]
 */
function buildToolsData(tools: McpToolWithPermission[]): ToolRow[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    permission: tool.allowed ? 'allowed' : 'requires-permission',
  }))
}

/**
 * Get contextual description for Connection section based on source type
 */
function getConnectionDescription(source: LoadedSource, t: (key: string) => string): string {
  const { type, mcp } = source.config

  if (type === 'mcp') {
    if (mcp?.transport === 'stdio') {
      return t('common:sourceInfo.connectionLocalCommand')
    }
    return t('common:sourceInfo.connectionServerUrl')
  }
  if (type === 'api') {
    return t('common:sourceInfo.connectionApiBaseUrl')
  }
  if (type === 'local') {
    return t('common:sourceInfo.connectionLocalPath')
  }
  return t('common:sourceInfo.connectionDetails')
}

/**
 * Get contextual description for Permissions section based on source type
 */
function getPermissionsDescription(source: LoadedSource, t: (key: string) => string): string {
  const { type } = source.config

  if (type === 'mcp') {
    return t('common:sourceInfo.permissionsMcp')
  }
  if (type === 'api') {
    return t('common:sourceInfo.permissionsApi')
  }
  return t('common:sourceInfo.permissionsLocal')
}

export default function SourceInfoPage({ sourceSlug, workspaceId, onDelete }: SourceInfoPageProps) {
  const { t } = useTranslation(['common'])
  const { navigateToSource } = useNavigation()
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfigFile | null>(null)
  const [mcpTools, setMcpTools] = useState<McpToolWithPermission[] | null>(null)
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false)
  const [mcpToolsError, setMcpToolsError] = useState<string | null>(null)
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)


  // Load source data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSource = async () => {
      try {
        const sources = await window.electronAPI.getSources(workspaceId)

        if (!isMounted) return

        const found = sources.find((s) => s.config.slug === sourceSlug)
        if (found) {
          setSource(found)

          const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
          if (isMounted) {
            setPermissionsConfig(config)
          }
        } else {
          setError('Source not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load source')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSource()

    return () => {
      isMounted = false
    }
  }, [workspaceId, sourceSlug])

  // Load MCP tools when source is loaded and is MCP type
  useEffect(() => {
    if (!source || source.config.type !== 'mcp') {
      setMcpTools(null)
      setMcpToolsError(null)
      return
    }

    let isMounted = true
    setMcpToolsLoading(true)
    setMcpToolsError(null)

    const loadTools = async () => {
      try {
        const result = await window.electronAPI.getMcpTools(workspaceId, sourceSlug)
        if (!isMounted) return

        if (result.success && result.tools) {
          setMcpTools(result.tools)
        } else {
          setMcpToolsError(result.error || 'Failed to load tools')
        }
      } catch (err) {
        if (!isMounted) return
        setMcpToolsError(err instanceof Error ? err.message : 'Failed to load tools')
      } finally {
        if (isMounted) setMcpToolsLoading(false)
      }
    }

    loadTools()

    return () => {
      isMounted = false
    }
  }, [source, workspaceId, sourceSlug])

  // Load workspace settings (for localMcpEnabled)
  useEffect(() => {
    if (!workspaceId) return
    window.electronAPI.getWorkspaceSettings(workspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
      }
    }).catch((err) => {
      console.error('[SourceInfoPage] Failed to load workspace settings:', err)
    })
  }, [workspaceId])

  // Listen for source folder changes
  useEffect(() => {
    if (!window.electronAPI?.onSourcesChanged) return

    const cleanup = window.electronAPI.onSourcesChanged((sources) => {
      const updated = sources.find((s) => s.config.slug === sourceSlug)

      if (updated) {
        setSource(updated)

        const loadPermissionsConfig = async () => {
          try {
            const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
            setPermissionsConfig(config)
          } catch (err) {
            console.error('[SourceInfoPage] Failed to reload permissions config:', err)
          }
        }
        loadPermissionsConfig()
      }
    })

    return cleanup
  }, [sourceSlug, workspaceId])

  // Compute source URL
  const sourceUrl = useMemo(() => source ? getSourceUrl(source) : null, [source])

  // Build data for PermissionsDataTable
  const apiPermissionsData = useMemo(() => {
    if (!permissionsConfig || source?.config.type === 'mcp') return []
    return buildApiPermissionsData(permissionsConfig)
  }, [permissionsConfig, source])

  const mcpPermissionsData = useMemo(() => {
    if (!permissionsConfig || source?.config.type !== 'mcp') return []
    return buildMcpPermissionsData(permissionsConfig)
  }, [permissionsConfig, source])

  // Build data for ToolsDataTable
  const toolsData = useMemo(() => {
    if (!mcpTools) return []
    return buildToolsData(mcpTools)
  }, [mcpTools])

  // Handle opening URL (website or folder)
  const handleOpenUrl = useCallback(async () => {
    if (!source || !sourceUrl) return
    if (window.electronAPI) {
      if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        await window.electronAPI.openUrl(sourceUrl)
      } else {
        await window.electronAPI.showInFolder(sourceUrl)
      }
    }
  }, [source, sourceUrl])

  // Handle opening source folder
  const handleOpenSourceFolder = useCallback(async () => {
    if (!source) return
    if (window.electronAPI) {
      await window.electronAPI.showInFolder(source.folderPath)
    }
  }, [source])

  // Handle deleting source (navigates to source list, preserving current filter)
  const handleDelete = useCallback(async () => {
    if (!source) return
    try {
      await window.electronAPI.deleteSource(workspaceId, sourceSlug)
      toast.success(t('common:sourceInfo.deletedToast', { name: source.config.name }))
      navigateToSource() // Navigate to source list, preserving filter
      onDelete?.()
    } catch (err) {
      toast.error(t('common:sourceInfo.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common:unknownError'),
      })
    }
  }, [source, workspaceId, sourceSlug, onDelete, navigateToSource, t])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`workagents://sources/source/${sourceSlug}?window=focused`)
  }, [sourceSlug])

  // Get source name for header
  const sourceName = source?.config.name || sourceSlug

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!source && !loading && !error ? 'Source not found' : undefined}
    >
      <Info_Page.Header
        title={sourceName}
        titleMenu={
          <SourceMenu
            sourceSlug={sourceSlug}
            sourceName={sourceName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenSourceFolder}
            onDelete={handleDelete}
          />
        }
      />

      {source && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and tagline */}
          <Info_Page.Hero
            avatar={<SourceAvatar source={source} fluid />}
            title={source.config.name}
            tagline={source.config.tagline}
          />

          {/* Disabled Warning */}
          {source.config.mcp?.transport === 'stdio' && !localMcpEnabled && (
            <Info_Alert variant="warning" icon={<AlertCircle className="h-4 w-4" />}>
              <Info_Alert.Title>{t('common:sourceInfo.disabledTitle')}</Info_Alert.Title>
              <Info_Alert.Description>
                {t('common:sourceInfo.disabledDescription')}
              </Info_Alert.Description>
            </Info_Alert>
          )}

          {/* Connection */}
          <Info_Section
            title={t('common:sourceInfo.connectionTitle')}
            description={getConnectionDescription(source, t)}
            actions={
              // EditPopover for AI-assisted config.json editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('source-config', source.folderPath)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${source.folderPath}/config.json`,
                }}
              />
            }
          >
            <Info_Table
              footer={source.config.connectionError && (
                <div className="px-4 py-2 border-t border-border/30 bg-destructive/5">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{source.config.connectionError}</span>
                  </div>
                </div>
              )}
            >
              <Info_Table.Row label={t('common:sourceInfo.typeLabel')} value={source.config.type.toUpperCase()} />
              {sourceUrl && (
                <Info_Table.Row label={t('common:sourceInfo.urlLabel')}>
                  <button
                    onClick={handleOpenUrl}
                    className="truncate hover:underline text-foreground focus:outline-none focus-visible:underline text-left block w-full"
                  >
                    {sourceUrl}
                  </button>
                </Info_Table.Row>
              )}
              <Info_Table.Row label={t('common:sourceInfo.lastTestedLabel')} value={formatRelativeTime(source.config.lastTestedAt, t)} />
            </Info_Table>
          </Info_Section>

          {/* Permissions - for API and local sources */}
          {source.config.type !== 'mcp' && permissionsConfig && apiPermissionsData.length > 0 && (
            <Info_Section
              title={t('common:sourceInfo.permissionsTitle')}
              description={getPermissionsDescription(source, t)}
              actions={
                // EditPopover for AI-assisted permissions.json editing
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('source-permissions', source.folderPath)}
                  secondaryAction={{
                    label: 'Edit File',
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <PermissionsDataTable data={apiPermissionsData} fullscreen fullscreenTitle={t('common:sourceInfo.permissionsTitle')} />
            </Info_Section>
          )}

          {/* Tools - for MCP sources */}
          {source.config.type === 'mcp' && (
            <Info_Section
              title={t('common:sourceInfo.toolsTitle')}
              description={t('common:sourceInfo.toolsDescription')}
              actions={
                // EditPopover for AI-assisted tool permissions editing
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('source-tool-permissions', source.folderPath)}
                  secondaryAction={{
                    label: 'Edit File',
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <ToolsDataTable
                data={toolsData}
                loading={mcpToolsLoading}
                error={mcpToolsError ?? undefined}
              />
            </Info_Section>
          )}

          {/* Permissions - for MCP sources */}
          {source.config.type === 'mcp' && permissionsConfig && mcpPermissionsData.length > 0 && (
            <Info_Section
              title={t('common:sourceInfo.permissionsTitle')}
              description={getPermissionsDescription(source, t)}
              actions={
                // EditPopover for AI-assisted permissions.json editing
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('source-permissions', source.folderPath)}
                  secondaryAction={{
                    label: 'Edit File',
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <PermissionsDataTable data={mcpPermissionsData} hideTypeColumn fullscreen fullscreenTitle={t('common:sourceInfo.permissionsTitle')} />
            </Info_Section>
          )}

          {/* Documentation */}
          {source.guide?.raw && (
            <Info_Section
              title={t('common:sourceInfo.documentationTitle')}
              description={t('common:sourceInfo.documentationDescription')}
              actions={
                // EditPopover for AI-assisted guide.md editing with "Edit File" as secondary action
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('source-guide', source.folderPath)}
                  secondaryAction={{
                    label: 'Edit File',
                    filePath: `${source.folderPath}/guide.md`,
                  }}
                />
              }
            >
              <Info_Markdown maxHeight={540} fullscreen>
                {source.guide.raw}
              </Info_Markdown>
            </Info_Section>
          )}
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
