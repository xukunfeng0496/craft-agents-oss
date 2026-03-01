/**
 * HooksSettingsPage
 *
 * Manage workspace hooks (lifecycle event handlers).
 *
 * Settings:
 * - Create, edit, and delete hooks
 * - Configure hook triggers (events)
 * - Set hook schedules (cron expressions)
 * - Enable/disable hooks
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { useTranslation } from 'react-i18next'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useAppShellContext } from '@/context/AppShellContext'
import { Clock, Plus, Trash2, Calendar, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cronToDescription, cronToSchedule } from '@work-agent/shared/schedules/utils'

import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SchedulePicker } from '@/components/hooks/SchedulePicker'
import type { ScheduleTime, ScheduleDay } from '@work-agent/shared/schedules'
import { scheduleToCron } from '@work-agent/shared/schedules/utils'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'hooks',
}

export function getHooksSettingsLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:hooks.pageTitle'),
    hooksTitle: t('settings:hooks.sections.hooks.title'),
    hooksDescription: t('settings:hooks.sections.hooks.description'),
  }
}

// ============================================
// Types
// ============================================

interface SchedulerHookData {
  id: string
  cron: string
  timezone?: string
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  enabled?: boolean
  prompt: string
}

interface HookFormData {
  name?: string
  prompt: string
  times: ScheduleTime[]
  days?: ScheduleDay[]
  labels?: string
  permissionMode: 'safe' | 'ask' | 'allow-all'
  enabled: boolean
}

// ============================================
// Hook Card Component
// ============================================

interface HookCardProps {
  hook: SchedulerHookData
  onEdit: (hook: SchedulerHookData) => void
  onDelete: (hook: SchedulerHookData) => void
  onToggleEnabled: (hook: SchedulerHookData, enabled: boolean) => void
}

function HookCard({ hook, onEdit, onDelete, onToggleEnabled }: HookCardProps) {
  const description = cronToDescription(hook.cron)
  const promptPreview = hook.prompt.length > 100
    ? hook.prompt.slice(0, 100) + '...'
    : hook.prompt

  return (
    <div className="p-4 rounded-lg border bg-card space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate">
              {hook.id}
            </span>
          </div>
          <div className="text-xs text-muted-foreground ml-6">
            {description}
          </div>
        </div>
        <Switch
          checked={hook.enabled ?? true}
          onCheckedChange={(checked) => onToggleEnabled(hook, checked)}
        />
      </div>

      {/* Prompt Preview */}
      <div className="text-xs text-muted-foreground/80 line-clamp-2 ml-6 italic">
        "{promptPreview}"
      </div>

      {/* Metadata */}
      {(hook.labels || hook.permissionMode) && (
        <div className="flex items-center gap-2 ml-6 flex-wrap">
          {hook.permissionMode && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {hook.permissionMode}
            </span>
          )}
          {hook.labels?.map((label, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 ml-6 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(hook)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(hook)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Hook Dialog Component
// ============================================

interface HookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hook?: SchedulerHookData
  onSave: (data: HookFormData) => Promise<void>
}

function HookDialog({ open, onOpenChange, hook, onSave }: HookDialogProps) {
  const isEdit = !!hook

  // Parse existing hook data
  const initialSchedule = hook ? cronToSchedule(hook.cron) : null
  const showComplexCronWarning = hook && !initialSchedule

  const [formData, setFormData] = useState<HookFormData>({
    name: hook?.id,
    prompt: hook?.prompt ?? '',
    times: initialSchedule?.times ?? [{ hour: 9, minute: 0 }],
    days: initialSchedule?.days,
    labels: hook?.labels?.join(', ') ?? '',
    permissionMode: hook?.permissionMode ?? 'ask',
    enabled: hook?.enabled ?? true,
  })

  const [isSaving, setIsSaving] = useState(false)

  // Reset form when dialog opens/closes or hook changes
  useEffect(() => {
    if (open) {
      const schedule = hook ? cronToSchedule(hook.cron) : null
      setFormData({
        name: hook?.id,
        prompt: hook?.prompt ?? '',
        times: schedule?.times ?? [{ hour: 9, minute: 0 }],
        days: schedule?.days,
        labels: hook?.labels?.join(', ') ?? '',
        permissionMode: hook?.permissionMode ?? 'ask',
        enabled: hook?.enabled ?? true,
      })
    }
  }, [open, hook])

  const handleSave = async () => {
    // Validation
    if (!formData.prompt.trim()) {
      toast.error('Prompt is required')
      return
    }

    if (formData.times.length === 0) {
      toast.error('At least one time is required')
      return
    }

    setIsSaving(true)
    try {
      await onSave(formData)
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save hook:', error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Scheduled Task' : 'Add Scheduled Task'}</DialogTitle>
          <DialogDescription>
            Configure a scheduled prompt that runs automatically at specified times.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Complex Cron Warning */}
          {showComplexCronWarning && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="text-xs text-warning">
                This hook uses a complex cron expression that cannot be edited in the UI.
                You can only modify the prompt and settings. To change the schedule, edit hooks.json directly.
              </div>
            </div>
          )}

          {/* Name (optional) */}
          <div className="space-y-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              placeholder="e.g., morning-standup"
              value={formData.name ?? ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Name cannot be changed after creation
              </p>
            )}
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt *</Label>
            <Textarea
              id="prompt"
              placeholder="Enter the prompt to send when this schedule triggers..."
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Schedule Picker */}
          {!showComplexCronWarning && (
            <SchedulePicker
              times={formData.times}
              days={formData.days}
              onChange={(times, days) => setFormData({ ...formData, times, days })}
            />
          )}

          {/* Labels */}
          <div className="space-y-2">
            <Label htmlFor="labels">Labels (optional)</Label>
            <Input
              id="labels"
              placeholder="e.g., daily, standup, review (comma-separated)"
              value={formData.labels}
              onChange={(e) => setFormData({ ...formData, labels: e.target.value })}
            />
          </div>

          {/* Permission Mode */}
          <div className="space-y-2">
            <Label htmlFor="permissionMode">Permission Mode</Label>
            <Select
              value={formData.permissionMode}
              onValueChange={(value: 'safe' | 'ask' | 'allow-all') =>
                setFormData({ ...formData, permissionMode: value })
              }
            >
              <SelectTrigger id="permissionMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">Safe (Read-only)</SelectItem>
                <SelectItem value="ask">Ask (Prompt for approval)</SelectItem>
                <SelectItem value="allow-all">Allow All (Auto-approve)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Enabled</Label>
            <Switch
              id="enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Hook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Main Component
// ============================================

export default function HooksSettingsPage() {
  const { t } = useTranslation(['settings'])
  const labels = getHooksSettingsLabels(t)

  const [hooks, setHooks] = useState<SchedulerHookData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingHook, setEditingHook] = useState<SchedulerHookData | undefined>()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingHook, setDeletingHook] = useState<SchedulerHookData | undefined>()

  // Load hooks
  const loadHooks = useCallback(async () => {
    if (!workspace?.id) return

    setIsLoading(true)
    try {
      const result = await window.electronAPI.listSchedulerHooks(activeWorkspaceId)
      setHooks(result)
    } catch (error) {
      console.error('Failed to load hooks:', error)
      toast.error('Failed to load hooks')
    } finally {
      setIsLoading(false)
    }
  }, [workspace?.id])

  useEffect(() => {
    loadHooks()
  }, [loadHooks])

  // Create/Update hook
  const handleSave = async (formData: HookFormData) => {
    if (!workspace?.id) return

    try {
      // Convert times/days to cron
      const cronExpressions = scheduleToCron(formData.times, formData.days)
      if (cronExpressions.length === 0) {
        toast.error('Invalid schedule')
        return
      }

      // Use first cron expression (we only support single time for now in the form)
      const cron = cronExpressions[0]!

      // Parse labels
      const labels = formData.labels
        ? formData.labels.split(',').map(l => l.trim()).filter(Boolean)
        : undefined

      const hookData = {
        id: formData.name || `hook-${Date.now()}`,
        cron,
        prompt: formData.prompt,
        permissionMode: formData.permissionMode,
        labels,
        enabled: formData.enabled,
      }

      if (editingHook) {
        // Update existing hook
        await window.electronAPI.updateSchedulerHook(activeWorkspaceId, {
          ...hookData,
          id: editingHook.id, // Keep original ID
        })
        toast.success('Hook updated')
      } else {
        // Create new hook
        await window.electronAPI.createSchedulerHook(activeWorkspaceId, hookData)
        toast.success('Hook created')
      }

      await loadHooks()
    } catch (error) {
      console.error('Failed to save hook:', error)
      toast.error('Failed to save hook')
      throw error
    }
  }

  // Delete hook
  const handleDelete = async () => {
    if (!workspace?.id || !deletingHook) return

    try {
      await window.electronAPI.deleteSchedulerHook(activeWorkspaceId, deletingHook.id)
      toast.success('Hook deleted')
      await loadHooks()
      setDeleteDialogOpen(false)
      setDeletingHook(undefined)
    } catch (error) {
      console.error('Failed to delete hook:', error)
      toast.error('Failed to delete hook')
    }
  }

  // Toggle enabled
  const handleToggleEnabled = async (hook: SchedulerHookData, enabled: boolean) => {
    if (!workspace?.id) return

    try {
      await window.electronAPI.updateSchedulerHook(activeWorkspaceId, {
        ...hook,
        enabled,
      })
      toast.success(enabled ? 'Hook enabled' : 'Hook disabled')
      await loadHooks()
    } catch (error) {
      console.error('Failed to toggle hook:', error)
      toast.error('Failed to update hook')
    }
  }

  // Open create dialog
  const handleCreate = () => {
    setEditingHook(undefined)
    setDialogOpen(true)
  }

  // Open edit dialog
  const handleEdit = (hook: SchedulerHookData) => {
    setEditingHook(hook)
    setDialogOpen(true)
  }

  // Open delete dialog
  const handleDeleteClick = (hook: SchedulerHookData) => {
    setDeletingHook(hook)
    setDeleteDialogOpen(true)
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('hooks')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Hooks Management */}
              <SettingsSection title={labels.hooksTitle} description={labels.hooksDescription}>
                <SettingsCard>
                  {isLoading ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                      Loading hooks...
                    </div>
                  ) : hooks.length === 0 ? (
                    <div className="p-8 text-center space-y-4">
                      <Calendar className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">No scheduled tasks</p>
                        <p className="text-xs text-muted-foreground/70">
                          Create scheduled tasks to automatically run prompts at specific times
                        </p>
                      </div>
                      <Button onClick={handleCreate} size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Scheduled Task
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Add Button */}
                      <div className="flex justify-end px-4 pt-4">
                        <Button onClick={handleCreate} size="sm">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Scheduled Task
                        </Button>
                      </div>

                      {/* Hooks List */}
                      <div className="space-y-3 px-4 pb-4">
                        {hooks.map((hook) => (
                          <HookCard
                            key={hook.id}
                            hook={hook}
                            onEdit={handleEdit}
                            onDelete={handleDeleteClick}
                            onToggleEnabled={handleToggleEnabled}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Create/Edit Dialog */}
      <HookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        hook={editingHook}
        onSave={handleSave}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingHook?.id}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
