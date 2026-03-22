import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { MoreHorizontal, Zap, Search, Download, Loader2 } from 'lucide-react'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import { SkillMenu } from './SkillMenu'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../../shared/types'
import { toast } from 'sonner'
import { MARKETPLACE_HOST, isMarketplaceConnectivityError } from '@work-agent/shared/marketplace'

type FilterType = 'all' | 'installed' | 'not-installed'

interface MarketplaceSkillMeta {
  name: string
  displayName: string
  description: string
  author: string
  tags: string[]
  version: string
}

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
  onSkillClick: (skillSlug: string) => void
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
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation(['common'])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [remoteSkills, setRemoteSkills] = useState<MarketplaceSkillMeta[]>([])
  const [remoteFetched, setRemoteFetched] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const fetchRemote = useCallback(async () => {
    if (remoteFetched) return
    try {
      const registry = await window.electronAPI.getMarketplaceRegistry()
      setRemoteSkills(registry.skills || [])
    } catch (error) {
      if (isMarketplaceConnectivityError(error)) {
        toast.error(t('common:marketplace.unreachable', { host: MARKETPLACE_HOST }))
      } else {
        toast.error(t('common:marketplace.loadFailed'), {
          description: error instanceof Error ? error.message : t('common:unknownError'),
        })
      }
    } finally {
      setRemoteFetched(true)
    }
  }, [remoteFetched, t])

  useEffect(() => {
    if (workspaceId) fetchRemote()
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
          (s.remote?.tags || []).some((t) => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [merged, search, filter])

  const handleInstall = async (name: string) => {
    if (!workspaceId) return
    setInstalling(name)
    try {
      await window.electronAPI.installMarketplaceSkill(workspaceId, name)
      toast.success(`${name} ${t('common:skillsList.installed')}`)
    } catch (e) {
      if (isMarketplaceConnectivityError(e)) {
        toast.error(t('common:marketplace.unreachable', { host: MARKETPLACE_HOST }))
      } else {
        toast.error(t('common:marketplace.installFailed'), {
          description: e instanceof Error ? e.message : t('common:unknownError'),
        })
      }
    } finally {
      setInstalling(null)
    }
  }

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('common:skillsList.filterAll') },
    { key: 'installed', label: t('common:skillsList.filterInstalled') },
    { key: 'not-installed', label: t('common:skillsList.filterNotInstalled') },
  ]

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <div className="px-3 pt-2 pb-1 flex flex-col gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('common:skillsList.searchPlaceholder')}
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
              {search ? t('common:skillsList.noMatch') : t('common:skillsList.noSkills')}
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
                onClick={() => onSkillClick(item.slug)}
                onDelete={() => onDeleteSkill(item.slug)}
              />
            ) : (
              <RemoteSkillItem
                key={item.slug}
                item={item}
                isSelected={selectedSkillSlug === item.slug}
                isFirst={index === 0}
                installing={installing === item.slug}
                onClick={() => onSkillClick(item.slug)}
                onInstall={() => handleInstall(item.slug)}
              />
            )
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ── Installed skill item ──

interface InstalledSkillItemProps {
  skill: LoadedSkill
  isSelected: boolean
  isFirst: boolean
  workspaceId?: string
  onClick: () => void
  onDelete: () => void
}

function InstalledSkillItem({ skill, isSelected, isFirst, workspaceId, onClick, onDelete }: InstalledSkillItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  return (
    <div className="skill-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="skill-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="skill-content relative group select-none pl-2 mr-2">
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
        </div>
        <button
          type="button"
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
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
              <span className="truncate">
                {skill.metadata.description}
              </span>
            </div>
          </div>
        </button>
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <SkillMenu
                    skillSlug={skill.slug}
                    skillName={skill.metadata.name}
                    onOpenInNewWindow={() => {
                      window.electronAPI.openUrl(`workagents://skills/skill/${skill.slug}?window=focused`)
                    }}
                    onShowInFinder={() => {
                      if (workspaceId) {
                        window.electronAPI.openSkillInFinder(workspaceId, skill.slug)
                      }
                    }}
                    onDelete={onDelete}
                  />
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
          </div>
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <SkillMenu
              skillSlug={skill.slug}
              skillName={skill.metadata.name}
              onOpenInNewWindow={() => {
                window.electronAPI.openUrl(`workagents://skills/skill/${skill.slug}?window=focused`)
              }}
              onShowInFinder={() => {
                if (workspaceId) {
                  window.electronAPI.openSkillInFinder(workspaceId, skill.slug)
                }
              }}
              onDelete={onDelete}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}

// ── Remote (not installed) skill item ──

interface RemoteSkillItemProps {
  item: MergedSkill
  isSelected: boolean
  isFirst: boolean
  installing: boolean
  onClick: () => void
  onInstall: () => void
}

function RemoteSkillItem({ item, isSelected, isFirst, installing, onClick, onInstall }: RemoteSkillItemProps) {
  const { t } = useTranslation(['common'])

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
        <button
          type="button"
          onClick={onClick}
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
        </button>
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
            {installing ? t('common:skillsList.installing') : t('common:skillsList.install')}
          </button>
        </div>
      </div>
    </div>
  )
}
