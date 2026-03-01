/**
 * HookDetailPage
 *
 * Detail/edit page for a single scheduled hook (SchedulerTick entry).
 * Supports editing name, prompt, schedule (times + days), timezone,
 * working directory, permission mode, labels, and enabled state.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Trash2, Plus, X, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { cronToSchedule, scheduleToCron } from '@work-agent/shared/schedules/utils'
import type { SchedulerHookData, ScheduleTime } from '@work-agent/shared/hooks-simple/crud'
import type { LabelConfig } from '@work-agent/shared/labels'
import { LabelIcon } from '@/components/ui/label-icon'

type ScheduleDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const ALL_DAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const WEEKDAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri']
const WEEKENDS: ScheduleDay[] = ['sat', 'sun']

interface HookDetailPageProps {
  hookId: string
  workspaceId: string
  isNew?: boolean
  onSaved?: () => void
  onDeleted?: () => void
}

export default function HookDetailPage({
  hookId,
  workspaceId,
  isNew = false,
  onSaved,
  onDeleted,
}: HookDetailPageProps) {
  const { t } = useTranslation(['common'])

  const [loading, setLoading] = useState(!isNew)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [times, setTimes] = useState<ScheduleTime[]>([{ hour: 9, minute: 0 }])
  const [days, setDays] = useState<ScheduleDay[]>([])
  const [isComplexCron, setIsComplexCron] = useState(false)
  const [rawCron, setRawCron] = useState('')
  const [timezone, setTimezone] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [permissionMode, setPermissionMode] = useState<'safe' | 'ask' | 'allow-all'>('safe')
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Load workspace labels
  const [workspaceLabels, setWorkspaceLabels] = useState<LabelConfig[]>([])
  useEffect(() => {
    if (!workspaceId) return
    window.electronAPI.listLabels(workspaceId).then(setWorkspaceLabels).catch(() => {})
  }, [workspaceId])

  // Load hook data
  useEffect(() => {
    if (isNew) return
    let mounted = true

    const load = async () => {
      try {
        const hooks = await window.electronAPI.listSchedulerHooks(workspaceId)
        const hook = hooks.find((h: SchedulerHookData) => h.id === hookId)
        if (!hook || !mounted) return

        setName(hook.name || '')
        setPrompt(hook.prompt)
        setEnabled(hook.enabled ?? true)
        setTimezone(hook.timezone || '')
        setWorkingDirectory(hook.workingDirectory || '')
        setPermissionMode(hook.permissionMode || 'safe')
        setSelectedLabels(hook.labels || [])

        // Parse cron to schedule
        const schedule = cronToSchedule(hook.cron)
        if (schedule) {
          setTimes(hook.times && hook.times.length > 0 ? hook.times : schedule.times)
          setDays(schedule.days || [])
          setIsComplexCron(false)
        } else {
          setIsComplexCron(true)
          setRawCron(hook.cron)
        }
      } catch (error) {
        console.error('Failed to load hook:', error)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [hookId, workspaceId, isNew])

  // Build cron from current state
  const buildCron = useCallback((): string => {
    if (isComplexCron) return rawCron
    const crons = scheduleToCron(times, days.length > 0 && days.length < 7 ? days : undefined)
    return crons[0] || '0 9 * * *'
  }, [isComplexCron, rawCron, times, days])

  // Timezone list
  const timezones = useMemo(() => {
    try {
      const zones = Intl.supportedValuesOf('timeZone')
      return zones.map(tz => {
        try {
          const formatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
          const parts = formatter.formatToParts(new Date())
          const offset = parts.find(p => p.type === 'timeZoneName')?.value || ''
          return { value: tz, label: `${tz} (${offset})` }
        } catch {
          return { value: tz, label: tz }
        }
      })
    } catch {
      return []
    }
  }, [])

  const [tzSearch, setTzSearch] = useState('')
  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return timezones.slice(0, 50)
    const lower = tzSearch.toLowerCase()
    return timezones.filter(tz => tz.label.toLowerCase().includes(lower)).slice(0, 50)
  }, [timezones, tzSearch])

  // Save handler
  const handleSave = async () => {
    setSaving(true)
    try {
      const cron = buildCron()
      const data: Omit<SchedulerHookData, 'id'> & { id?: string } = {
        name: name || undefined,
        prompt,
        cron,
        times: isComplexCron ? undefined : times,
        timezone: timezone || undefined,
        workingDirectory: workingDirectory || undefined,
        permissionMode,
        labels: selectedLabels.length > 0 ? selectedLabels : undefined,
        enabled,
      }

      if (isNew) {
        await window.electronAPI.createSchedulerHook(workspaceId, data)
      } else {
        await window.electronAPI.updateSchedulerHook(workspaceId, { ...data, id: hookId })
      }

      toast.success(t('common:schedules.saved'))
      window.dispatchEvent(new CustomEvent('hooks:changed'))
      onSaved?.()
    } catch (error) {
      toast.error(t('common:schedules.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Delete handler
  const handleDelete = async () => {
    try {
      await window.electronAPI.deleteSchedulerHook(workspaceId, hookId)
      toast.success(t('common:schedules.deleted'))
      window.dispatchEvent(new CustomEvent('hooks:changed'))
      setDeleteDialogOpen(false)
      onDeleted?.()
    } catch (error) {
      toast.error(t('common:schedules.updateFailed'))
    }
  }

  // Browse directory
  const handleBrowseDirectory = async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (result) setWorkingDirectory(result)
    } catch { /* user cancelled */ }
  }

  // Day toggle
  const toggleDay = (day: ScheduleDay) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  // Preset handlers
  const setPresetEveryDay = () => setDays([])
  const setPresetWeekdays = () => setDays([...WEEKDAYS])
  const setPresetWeekends = () => setDays([...WEEKENDS])

  // Time handlers
  const updateTime = (index: number, field: 'hour' | 'minute', value: number) => {
    setTimes(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }
  const addTime = () => setTimes(prev => [...prev, { hour: 9, minute: 0 }])
  const removeTime = (index: number) => {
    if (times.length <= 1) return
    setTimes(prev => prev.filter((_, i) => i !== index))
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common:schedules.loading')}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-2xl mx-auto py-6 px-6 space-y-6">
        {/* Name */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.name')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('common:schedules.detail.namePlaceholder')}
          />
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.prompt')}</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('common:schedules.detail.promptPlaceholder')}
            className="min-h-[150px] resize-y"
          />
        </div>

        <Separator />

        {/* Schedule */}
        <div className="space-y-4">
          <Label>{t('common:schedules.detail.schedule')}</Label>

          {isComplexCron ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('common:schedules.detail.unsupportedCron')}
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t('common:schedules.detail.rawCron')}</Label>
                <Input
                  value={rawCron}
                  onChange={(e) => setRawCron(e.target.value)}
                  className="font-mono text-sm"
                  placeholder="0 9 * * *"
                />
              </div>
            </div>
          ) : (
            <>
              {/* Time selectors */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  {t('common:schedules.detail.time')}
                </Label>
                {times.map((time, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={String(time.hour)}
                      onValueChange={(v) => updateTime(index, 'hour', parseInt(v, 10))}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {String(i).padStart(2, '0')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">:</span>
                    <Select
                      value={String(time.minute)}
                      onValueChange={(v) => updateTime(index, 'minute', parseInt(v, 10))}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 60 }, (_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {String(i).padStart(2, '0')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {times.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeTime(index)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addTime}
                  className="text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t('common:schedules.detail.addTime')}
                </Button>
              </div>

              {/* Day selectors */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  {t('common:schedules.detail.days')}
                </Label>
                <div className="flex gap-1.5 flex-wrap">
                  {ALL_DAYS.map((day) => {
                    const isSelected = days.length === 0 || days.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={cn(
                          'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        )}
                      >
                        {t(`common:schedules.detail.dayNames.${day}`)}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={setPresetEveryDay}
                  >
                    {t('common:schedules.detail.presetEveryDay')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={setPresetWeekdays}
                  >
                    {t('common:schedules.detail.presetWeekdays')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={setPresetWeekends}
                  >
                    {t('common:schedules.detail.presetWeekends')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <Separator />

        {/* Timezone */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.timezone')}</Label>
          <div className="space-y-1">
            <Input
              value={tzSearch}
              onChange={(e) => setTzSearch(e.target.value)}
              placeholder={t('common:schedules.detail.timezonePlaceholder')}
              className="text-sm"
            />
            {tzSearch && filteredTimezones.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-y-auto">
                {filteredTimezones.map(tz => (
                  <button
                    key={tz.value}
                    type="button"
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                      timezone === tz.value && 'bg-primary/10 text-primary'
                    )}
                    onClick={() => {
                      setTimezone(tz.value)
                      setTzSearch(tz.label)
                    }}
                  >
                    {tz.label}
                  </button>
                ))}
              </div>
            )}
            {timezone && (
              <p className="text-xs text-muted-foreground">
                {timezone}
                <button
                  type="button"
                  className="ml-2 text-primary hover:underline"
                  onClick={() => { setTimezone(''); setTzSearch('') }}
                >
                  <X className="h-3 w-3 inline" />
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Working Directory */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.workingDirectory')}</Label>
          <div className="flex gap-2">
            <Input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder={t('common:schedules.detail.workingDirectoryPlaceholder')}
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={handleBrowseDirectory}>
              <FolderOpen className="h-3.5 w-3.5 mr-1" />
              {t('common:schedules.detail.browse')}
            </Button>
          </div>
        </div>

        {/* Permission Mode */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.permissionMode')}</Label>
          <Select value={permissionMode} onValueChange={(v) => setPermissionMode(v as typeof permissionMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="safe">Explore</SelectItem>
              <SelectItem value="ask">Ask to Edit</SelectItem>
              <SelectItem value="allow-all">Auto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Labels */}
        <div className="space-y-2">
          <Label>{t('common:schedules.detail.labels')}</Label>
          {workspaceLabels.length > 0 ? (
            <div className="flex gap-1.5 flex-wrap">
              {workspaceLabels.map((label) => {
                const isSelected = selectedLabels.includes(label.id)
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() =>
                      setSelectedLabels(prev =>
                        isSelected ? prev.filter(id => id !== label.id) : [...prev, label.id]
                      )
                    }
                    className={cn(
                      'h-6 px-2 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors',
                      isSelected
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    <LabelIcon label={label} size="xs" />
                    {label.name}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('common:schedules.detail.labelsPlaceholder')}
            </p>
          )}
        </div>

        {/* Enabled */}
        <div className="flex items-center justify-between">
          <Label>{t('common:schedules.detail.enabled')}</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !prompt.trim()}>
            {t('common:schedules.detail.save')}
          </Button>
          {!isNew && (
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t('common:schedules.detail.delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:schedules.detail.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('common:schedules.detail.deleteConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common:schedules.detail.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
