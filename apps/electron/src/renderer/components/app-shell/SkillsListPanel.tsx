import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, MoreHorizontal, Search, Zap } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import type { LoadedSkill } from '../../../shared/types'
import { MARKETPLACE_HOST, isMarketplaceConnectivityError, isMarketplaceAuthError } from '@craft-agent/shared/marketplace'

/** A Chromium/transport-level connection failure (vs. a normal auth/HTTP result),
 * so we can show the clean "check network" message instead of a raw error code. */
function isConnectionLevelError(msg?: string): boolean {
  return !!msg && /ERR_(CONNECTION|PROXY|NAME_NOT_RESOLVED|INTERNET|NETWORK|TIMED_OUT|ADDRESS)|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(msg)
}
import type { MarketplaceSkillMeta } from '@craft-agent/shared/marketplace'

type FilterType = 'all' | 'installed' | 'not-installed'

interface MergedSkill {
  slug: string
  name: string
  description: string
  installed: boolean
  local?: LoadedSkill
  remote?: MarketplaceSkillMeta
}

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  className?: string
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [remoteSkills, setRemoteSkills] = useState<MarketplaceSkillMeta[]>([])
  const [remoteFetched, setRemoteFetched] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  const fetchRemote = useCallback(async (force = false) => {
    if (remoteFetched && !force) return
    try {
      const registry = await window.electronAPI.getMarketplaceRegistry()
      setRemoteSkills(registry.skills || [])
    } catch (error) {
      if (isMarketplaceAuthError(error)) {
        toast.error(t('marketplace.authRequired'), {
          action: { label: t('marketplace.login'), onClick: () => void handleMarketplaceLogin() },
        })
      } else if (isMarketplaceConnectivityError(error)) {
        toast.error(t('marketplace.unreachable', { host: MARKETPLACE_HOST }))
      } else {
        toast.error(t('marketplace.loadFailed'), {
          description: error instanceof Error ? error.message : t('common.unknownError'),
        })
      }
    } finally {
      setRemoteFetched(true)
    }
    // handleMarketplaceLogin is declared below; the closure reads the latest one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteFetched, t])

  // CVTE: the marketplace reuses the 统一门户 SSO identity (account/email persisted
  // at login) as its auth headers. Trigger the same portal SSO as the gateway, then
  // re-run the original action (e.g. install) once the identity is available.
  const handleMarketplaceLogin = useCallback(async (onDone?: () => void) => {
    const id = toast.loading(t('marketplace.loggingIn'))
    try {
      const r = await window.electronAPI.startCvtePortalOAuth()
      if (r.success) {
        toast.success(t('marketplace.loginSuccess'), { id })
        await fetchRemote(true)
        onDone?.()
      } else if (r.error && (isConnectionLevelError(r.error) || r.error.includes('RELAY_UNREACHABLE'))) {
        // Don't dump a raw "ERR_CONNECTION_RESET (-101)…" / relay error — show the clean network message.
        toast.error(t('marketplace.unreachable', { host: MARKETPLACE_HOST }), { id })
      } else if (r.error === 'CANCELLED') {
        toast.dismiss(id) // user cancelled login on purpose — no error noise
      } else {
        toast.error(t('marketplace.loginFailed'), { id, description: r.error })
      }
    } catch (e) {
      toast.error(t('marketplace.loginFailed'), { id, description: e instanceof Error ? e.message : undefined })
    }
  }, [t, fetchRemote])

  useEffect(() => {
    if (workspaceId) void fetchRemote()
  }, [workspaceId, fetchRemote])

  const merged = useMemo<MergedSkill[]>(() => {
    const map = new Map<string, MergedSkill>()
    for (const s of skills) {
      map.set(s.slug, {
        slug: s.slug,
        name: s.metadata.name,
        description: s.metadata.description,
        installed: true,
        local: s,
      })
    }
    for (const r of remoteSkills) {
      if (!map.has(r.name)) {
        map.set(r.name, {
          slug: r.name,
          name: r.displayName || r.name,
          description: r.description,
          installed: false,
          remote: r,
        })
      }
    }
    return Array.from(map.values())
  }, [skills, remoteSkills])

  const filtered = useMemo(() => {
    let list = merged
    if (filter === 'installed') list = list.filter((s) => s.installed)
    else if (filter === 'not-installed') list = list.filter((s) => !s.installed)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (s) =>
          s.slug.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.remote?.tags || []).some((tag) => tag.toLowerCase().includes(q))
      )
    }
    return list
  }, [merged, search, filter])

  const handleInstall = async (name: string) => {
    if (!workspaceId) return
    setInstalling(name)
    try {
      await window.electronAPI.installMarketplaceSkill(workspaceId, name)
      toast.success(`${name} ${t('skillsList.installed')}`)
    } catch (e) {
      if (isMarketplaceAuthError(e)) {
        toast.error(t('marketplace.authRequired'), {
          action: { label: t('marketplace.login'), onClick: () => void handleMarketplaceLogin(() => void handleInstall(name)) },
        })
      } else if (isMarketplaceConnectivityError(e)) {
        toast.error(t('marketplace.unreachable', { host: MARKETPLACE_HOST }))
      } else {
        toast.error(t('marketplace.installFailed'), {
          description: e instanceof Error ? e.message : t('common.unknownError'),
        })
      }
    } finally {
      setInstalling(null)
    }
  }

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('skillsList.filterAll') },
    { key: 'installed', label: t('skillsList.filterInstalled') },
    { key: 'not-installed', label: t('skillsList.filterNotInstalled') },
  ]

  // If no remote skills have been fetched yet and there's no search/filter,
  // use the original EntityPanel for a clean empty-state experience.
  const hasMarketplaceContent = remoteFetched && remoteSkills.length > 0
  const showMergedView = hasMarketplaceContent || search.trim() !== '' || filter !== 'all'

  if (!showMergedView) {
    return (
      <>
        <EntityPanel<LoadedSkill>
          items={skills}
          getId={(s) => s.slug}
          selection={skillSelection}
          selectedId={selectedSkillSlug}
          onItemClick={onSkillClick}
          className={className}
          containerProps={{ 'data-list-role': 'skills' }}
          emptyState={
            <EntityListEmptyScreen
              icon={<Zap />}
              title={t('skillsList.noSkillsConfigured')}
              description={t('skillsList.emptyDescription')}
              docKey="skills"
            >
              {workspaceRootPath && (
                <EditPopover
                  align="center"
                  trigger={
                    <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                      {t('skillsList.addSkill')}
                    </button>
                  }
                  {...getEditConfig('add-skill', workspaceRootPath)}
                />
              )}
            </EntityListEmptyScreen>
          }
          mapItem={(skill) => ({
            icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
            title: skill.metadata.name,
            badges: (
              <span className="flex items-center gap-1.5 min-w-0">
                {skill.source === 'project' && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
                    {t('skillsList.projectBadge')}
                  </span>
                )}
                <span className="truncate">{skill.metadata.description}</span>
              </span>
            ),
            menu: (
              <SkillMenu
                skillSlug={skill.slug}
                skillName={skill.metadata.name}
                onOpenInNewWindow={() => window.electronAPI.openUrl(`workagents://skills/skill/${skill.slug}?window=focused`)}
                onShowInFinder={async () => {
                  if (!canRevealLocally) return
                  try {
                    await window.electronAPI.showInFolder(skill.path)
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                      description: message,
                    })
                  }
                }}
                canShowInFinder={canRevealLocally}
                onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
                canDelete={skill.source === 'workspace'}
                deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
                onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
                  setSendResourceSlug(skill.slug)
                  setSendResourceLabel(skill.metadata.name)
                  setSendDialogOpen(true)
                } : undefined}
              />
            ),
          })}
        />

        {sendResourceSlug && (
          <SendResourceToWorkspaceDialog
            open={sendDialogOpen}
            onOpenChange={setSendDialogOpen}
            resourceType="skill"
            resourceIds={[sendResourceSlug]}
            resourceLabel={sendResourceLabel}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
          />
        )}
      </>
    )
  }

  // Merged view: installed + marketplace remote skills
  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <div className="px-3 pt-2 pb-1 flex flex-col gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('skillsList.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
        <div className="flex gap-0.5 rounded-md bg-foreground/[0.03] p-0.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={cn(
                'flex-1 text-[11px] font-medium py-1 rounded-[5px] transition-colors',
                filter === tab.key
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground/70'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="pb-2">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              {search ? t('skillsList.noMatch') : t('skillsList.noSkillsConfigured')}
            </div>
          )}
          {filtered.map((item, index) =>
            item.installed && item.local ? (
              <InstalledSkillItem
                key={item.slug}
                skill={item.local}
                isSelected={selectedSkillSlug === item.slug}
                isFirst={index === 0}
                workspaceId={workspaceId}
                canRevealLocally={canRevealLocally}
                hasOtherWorkspaces={hasOtherWorkspaces}
                onClick={() => onSkillClick(item.local!)}
                onDelete={() => onDeleteSkill(item.slug)}
                onSendToWorkspace={() => {
                  setSendResourceSlug(item.slug)
                  setSendResourceLabel(item.name)
                  setSendDialogOpen(true)
                }}
              />
            ) : (
              <RemoteSkillItem
                key={item.slug}
                item={item}
                isSelected={selectedSkillSlug === item.slug}
                isFirst={index === 0}
                installing={installing === item.slug}
                onInstall={() => handleInstall(item.slug)}
              />
            )
          )}
        </div>
      </ScrollArea>

      {sendResourceSlug && (
        <SendResourceToWorkspaceDialog
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          resourceType="skill"
          resourceIds={[sendResourceSlug]}
          resourceLabel={sendResourceLabel}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      )}
    </div>
  )
}

// ── Installed skill item ──

interface InstalledSkillItemProps {
  skill: LoadedSkill
  isSelected: boolean
  isFirst: boolean
  workspaceId?: string
  canRevealLocally: boolean
  hasOtherWorkspaces: boolean
  onClick: () => void
  onDelete: () => void
  onSendToWorkspace: () => void
}

function InstalledSkillItem({
  skill,
  isSelected,
  isFirst,
  workspaceId,
  canRevealLocally,
  hasOtherWorkspaces,
  onClick,
  onDelete,
  onSendToWorkspace,
}: InstalledSkillItemProps) {
  const { t } = useTranslation()

  return (
    <div className="skill-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="skill-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="skill-content relative group select-none pl-2 mr-2">
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
        </div>
        <button
          type="button"
          className={cn(
            'flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
          onClick={onClick}
        >
          <div className="w-5 h-5 shrink-0" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {skill.metadata.name}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              <span className="truncate">{skill.metadata.description}</span>
            </div>
          </div>
        </button>
        <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* SkillMenu uses useMenuComponents() — it MUST sit inside a menu
              provider (same container pattern as entity-row's menu slot) */}
          <DropdownMenu modal={true}>
            <DropdownMenuTrigger asChild>
              <div className="p-1 rounded-[6px] hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end">
              <DropdownMenuProvider>
                <SkillMenu
                  skillSlug={skill.slug}
                  skillName={skill.metadata.name}
                  onOpenInNewWindow={() => window.electronAPI.openUrl(`workagents://skills/skill/${skill.slug}?window=focused`)}
                  onShowInFinder={async () => {
                    if (!canRevealLocally) return
                    try {
                      await window.electronAPI.showInFolder(skill.path)
                    } catch (err) {
                      const message = err instanceof Error ? err.message : String(err)
                      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                        description: message,
                      })
                    }
                  }}
                  canShowInFinder={canRevealLocally}
                  onDelete={skill.source === 'workspace' ? onDelete : undefined}
                  canDelete={skill.source === 'workspace'}
                  deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
                  onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? onSendToWorkspace : undefined}
                />
              </DropdownMenuProvider>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

// ── Remote (not installed) skill item ──

interface RemoteSkillItemProps {
  item: MergedSkill
  isSelected: boolean
  isFirst: boolean
  installing: boolean
  onInstall: () => void
}

function RemoteSkillItem({ item, isSelected, isFirst, installing, onInstall }: RemoteSkillItemProps) {
  const { t } = useTranslation()

  return (
    <div className="skill-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="skill-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="skill-content relative group select-none pl-2 mr-2">
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <div className="w-5 h-5 rounded-md bg-foreground/5 flex items-center justify-center">
            <Zap className="h-3 w-3 text-muted-foreground" />
          </div>
        </div>
        <div
          className={cn(
            'flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm rounded-[8px] transition-all outline-none',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
        >
          <div className="w-5 h-5 shrink-0" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-start gap-2 w-full pr-16 min-w-0">
              <div
                className={cn(
                  'font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]',
                  isSelected ? 'text-foreground/80' : 'text-foreground/60'
                )}
              >
                {item.name}
              </div>
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs w-full -mb-[2px] pr-16 min-w-0',
                isSelected ? 'text-foreground/55' : 'text-foreground/40'
              )}
            >
              <span className="truncate">{item.description}</span>
            </div>
          </div>
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
          <button
            type="button"
            disabled={installing}
            onClick={onInstall}
            className={cn(
              'inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-md transition-colors',
              'bg-foreground/5 hover:bg-foreground/10 text-foreground/70 hover:text-foreground',
              installing && 'opacity-50 pointer-events-none'
            )}
          >
            {installing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {installing ? t('skillsList.installing') : t('skillsList.install')}
          </button>
        </div>
      </div>
    </div>
  )
}
