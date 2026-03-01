/**
 * HooksListPanel
 *
 * Navigator panel list for scheduled hooks (SchedulerTick entries).
 * Shows each hook as a list item with schedule description and enable toggle.
 * Clicking selects a hook for detail view.
 */

import { useState, useEffect, useCallback } from 'react'
import { Clock, Plus, Pause, Calendar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { cronToDescription } from '@work-agent/shared/schedules/utils'
import { toast } from 'sonner'

interface SchedulerHookData {
  id: string
  name?: string
  cron: string
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  prompt: string
  workingDirectory?: string
}

interface HooksListPanelProps {
  workspaceId: string
  selectedHookId?: string | null
  onHookClick: (hookId: string) => void
  onAddHook?: () => void
}

export function HooksListPanel({
  workspaceId,
  selectedHookId,
  onHookClick,
  onAddHook,
}: HooksListPanelProps) {
  const { t } = useTranslation(['common'])
  const [hooks, setHooks] = useState<SchedulerHookData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadHooks = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const result = await window.electronAPI.listSchedulerHooks(workspaceId)
      setHooks(result)
    } catch (error) {
      console.error('Failed to load hooks:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadHooks()
  }, [loadHooks])

  // Listen for hook changes from detail page
  useEffect(() => {
    const handler = () => { loadHooks() }
    window.addEventListener('hooks:changed', handler)
    return () => window.removeEventListener('hooks:changed', handler)
  }, [loadHooks])

  const handleToggle = async (hook: SchedulerHookData, enabled: boolean) => {
    try {
      await window.electronAPI.updateSchedulerHook(workspaceId, { ...hook, enabled })
      setHooks(prev => prev.map(h => h.id === hook.id ? { ...h, enabled } : h))
    } catch (error) {
      toast.error(t('common:schedules.updateFailed'))
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common:schedules.loading')}</p>
      </div>
    )
  }

  if (hooks.length === 0) {
    return (
      <div className="flex flex-col flex-1">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Calendar />
            </EmptyMedia>
            <EmptyTitle>{t('common:schedules.empty.title')}</EmptyTitle>
            <EmptyDescription>
              {t('common:schedules.empty.description')}
            </EmptyDescription>
          </EmptyHeader>
          {onAddHook && (
            <EmptyContent>
              <button
                type="button"
                onClick={onAddHook}
                className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
              >
                <Plus className="h-3 w-3 mr-1.5" />
                {t('common:schedules.addTask')}
              </button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ScrollArea className="flex-1">
        <div className="pb-2 pt-2">
          {hooks.map((hook, index) => (
            <HookListItem
              key={hook.id}
              hook={hook}
              isSelected={selectedHookId === hook.id}
              isFirst={index === 0}
              onClick={() => onHookClick(hook.id)}
              onToggle={(enabled) => handleToggle(hook, enabled)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

interface HookListItemProps {
  hook: SchedulerHookData
  isSelected: boolean
  isFirst: boolean
  onClick: () => void
  onToggle: (enabled: boolean) => void
}

function HookListItem({ hook, isSelected, isFirst, onClick, onToggle }: HookListItemProps) {
  const { t } = useTranslation(['common'])
  const description = cronToDescription(hook.cron)
  const isEnabled = hook.enabled ?? true

  // Localize the description
  const localizedDescription = description
    .replace(/^Every day/, t('common:schedules.everyDay'))
    .replace(/^Weekdays/, t('common:schedules.weekdays'))
    .replace(/^Weekends/, t('common:schedules.weekends'))
    .replace(/ at /, ` ${t('common:schedules.at')} `)

  return (
    <div className="hook-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="relative group select-none pl-2 mr-2">
        {/* Icon */}
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <div className={cn(
            'h-7 w-7 rounded-lg flex items-center justify-center',
            isEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}>
            {isEnabled
              ? <Clock className="h-3.5 w-3.5" />
              : <Pause className="h-3.5 w-3.5" />
            }
          </div>
        </div>

        <button
          type="button"
          className={cn(
            'flex w-full items-start gap-2 pl-2 pr-12 py-3 text-left text-sm transition-all outline-none rounded-[8px]',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
          onClick={onClick}
        >
          {/* Spacer for icon */}
          <div className="w-9 shrink-0" />
          <div className="flex-1 min-w-0 pt-0.5">
            <div className={cn(
              'font-medium text-sm truncate',
              !isEnabled && 'text-muted-foreground'
            )}>
              {hook.name || hook.prompt.slice(0, 40) || hook.id}
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {localizedDescription}
            </div>
          </div>
        </button>

        {/* Toggle positioned absolutely */}
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggle}
            className="scale-75 origin-right"
          />
        </div>
      </div>
    </div>
  )
}
