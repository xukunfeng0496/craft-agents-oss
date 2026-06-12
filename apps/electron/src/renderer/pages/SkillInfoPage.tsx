/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import type { LoadedSkill, SkillVariable } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
  workingDirectory?: string
}

/**
 * SkillVarsEditor — inline editor for skill variable values.
 * Values are password-type inputs; already-set vars show 8-dot placeholder.
 * Empty input on save = delete that variable.
 */
function SkillVarsEditor({
  workspaceId,
  skillSlug,
  vars,
}: {
  workspaceId: string
  skillSlug: string
  vars: SkillVariable[]
}) {
  const { t } = useTranslation()
  // Track which vars are set (true = has a stored value)
  const [setStatus, setSetStatus] = React.useState<Record<string, boolean>>({})
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const loadedRef = useRef(false)

  // Load set-status on mount
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    const varNames = vars.map((v) => v.name)
    window.electronAPI.getSkillVars(workspaceId, skillSlug, varNames)
      .then((status) => setSetStatus(status))
      .catch(() => { /* non-fatal — show empty state */ })
  }, [workspaceId, skillSlug, vars])

  const handleChange = useCallback((name: string, value: string) => {
    setDraft((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // Only send vars that have been typed into (non-undefined draft)
      const toSend: Record<string, string> = {}
      for (const v of vars) {
        if (draft[v.name] !== undefined) {
          toSend[v.name] = draft[v.name]
        }
      }
      if (Object.keys(toSend).length > 0) {
        await window.electronAPI.setSkillVars(workspaceId, skillSlug, toSend)
        // Refresh set-status
        const varNames = vars.map((vr) => vr.name)
        const newStatus = await window.electronAPI.getSkillVars(workspaceId, skillSlug, varNames)
        setSetStatus(newStatus)
        // Clear draft for saved vars
        setDraft((prev) => {
          const next = { ...prev }
          for (const name of Object.keys(toSend)) {
            delete next[name]
          }
          return next
        })
      }
      toast.success(t('skillInfo.varSaved'))
    } catch (err) {
      toast.error(t('skillInfo.varSaveFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }, [workspaceId, skillSlug, vars, draft, t])

  const hasDraft = Object.keys(draft).length > 0

  return (
    <div className="space-y-3 px-4 py-3">
      <p className="text-xs text-muted-foreground">{t('skillInfo.varsDesc')}</p>
      <div className="space-y-2">
        {vars.map((v) => {
          const isSet = setStatus[v.name] === true
          const draftValue = draft[v.name]
          // Placeholder: 8 dots if already set and no draft typed, else example or generic
          const placeholder =
            draftValue === undefined && isSet
              ? '••••••••'
              : v.example
                ? v.example
                : t('skillInfo.varPlaceholder')
          return (
            <div key={v.name} className="grid grid-cols-[1fr_2fr] gap-3 items-start">
              <div className="pt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono font-medium text-foreground leading-none">{v.name}</span>
                  {v.required && (
                    <span className="text-[10px] text-destructive font-medium leading-none">{t('skillInfo.varRequired')}</span>
                  )}
                </div>
                {v.description && (
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{v.description}</p>
                )}
              </div>
              <input
                type="password"
                autoComplete="off"
                className="w-full h-8 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                value={draftValue ?? ''}
                placeholder={placeholder}
                onChange={(e) => handleChange(v.name, e.target.value)}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-end pt-1">
        <button
          disabled={!hasDraft || saving}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('skillInfo.varSave')}
        </button>
      </div>
    </div>
  )
}

export default function SkillInfoPage({ skillSlug, workspaceId, workingDirectory }: SkillInfoPageProps) {
  const { t } = useTranslation()
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId, workingDirectory)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)
        } else {
          setError(t('skillInfo.notFound'))
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : t('skillInfo.failedToLoad'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((changedWorkspaceId, skills) => {
      if (changedWorkspaceId !== workspaceId) return
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug, workingDirectory])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(skill.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: message,
      })
    }
  }, [canRevealLocally, skill, t])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      if (skill.source !== 'workspace') return
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(t('skillInfo.deletedSkill', { name: skill.metadata.name }))
      navigate(routes.view.skills())
    } catch (err) {
      toast.error(t('skillInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [skill, workspaceId, skillSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`workagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug
  const canDeleteSkill = skill?.source === 'workspace'

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder
  const handleLocationClick = async () => {
    if (!skill || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(skill.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: message,
      })
    }
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? t('skillInfo.notFound') : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            canShowInFinder={canRevealLocally}
            onDelete={canDeleteSkill ? handleDelete : undefined}
            canDelete={canDeleteSkill}
            deleteLabel={canDeleteSkill ? t('skillInfo.deleteSkill') : t('skillInfo.managedByProject')}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title={t('skillInfo.metadata')}
            actions={
              // EditPopover for AI-assisted metadata editing (name, description in frontmatter)
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-metadata', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={skill.slug} />
              <Info_Table.Row label={t('common.name')}>{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label={t('common.description')}>
                {skill.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.source')}>
                {skill.source === 'project' ? t('skillInfo.sourceProject') :
                 skill.source === 'global' ? t('skillInfo.sourceGlobal') :
                 t('skillInfo.sourceWorkspace')}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.location')}>
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(skill.path)}
                </button>
              </Info_Table.Row>
              {skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0 && (
                <Info_Table.Row label={t('skillInfo.requiredSources')}>
                  {skill.metadata.requiredSources.join(', ')}
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title={t('skillInfo.permissionModes')}>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('skillInfo.permissionModesDesc')}
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">{t('skillInfo.explore')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.exploreDesc')}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.askToEdit')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.askToEditDesc')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.auto')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.autoDesc')}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Variables */}
          {skill.metadata.vars && skill.metadata.vars.length > 0 && (
            <Info_Section title={t('skillInfo.vars')}>
              <SkillVarsEditor
                workspaceId={workspaceId}
                skillSlug={skillSlug}
                vars={skill.metadata.vars}
              />
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title={t('skillInfo.instructions')}
            actions={
              // EditPopover for AI-assisted editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-instructions', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {skill.content || t('skillInfo.noInstructions')}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
