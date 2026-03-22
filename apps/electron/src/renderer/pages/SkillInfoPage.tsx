/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SkillVariablesSection } from '@/components/skills/SkillVariablesSection'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { MARKETPLACE_HOST, isMarketplaceConnectivityError, type MarketplaceSkillPreview } from '@work-agent/shared/marketplace'
import type { LoadedSkill } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
}

type SkillInfoData =
  | { kind: 'local'; skill: LoadedSkill }
  | { kind: 'marketplace'; skill: MarketplaceSkillPreview }

export default function SkillInfoPage({ skillSlug, workspaceId }: SkillInfoPageProps) {
  const { t } = useTranslation(['common'])
  const [skillData, setSkillData] = useState<SkillInfoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load skill data
  useEffect(() => {
    let isMounted = true

    const loadSkill = async () => {
      setLoading(true)
      setError(null)

      try {
        const skills = await window.electronAPI.getSkills(workspaceId)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkillData({ kind: 'local', skill: found })
          return
        }

        const preview = await window.electronAPI.getMarketplaceSkillPreview(skillSlug)
        if (!isMounted) return

        setSkillData({ kind: 'marketplace', skill: preview })
      } catch (err) {
        if (!isMounted) return
        setSkillData(null)
        if (err instanceof Error && err.message === 'Skill not found in marketplace') {
          setError(t('common:info.skillNotFound'))
        } else if (isMarketplaceConnectivityError(err)) {
          setError(t('common:marketplace.unreachable', { host: MARKETPLACE_HOST }))
        } else {
          setError(err instanceof Error ? err.message : t('common:marketplace.previewFailed'))
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.(() => {
      void loadSkill()
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug, t])

  const skill = skillData?.kind === 'local' ? skillData.skill : null
  const previewSkill = React.useMemo<LoadedSkill | null>(() => {
    if (!skillData) return null
    if (skillData.kind === 'local') return skillData.skill

    return {
      slug: skillData.skill.slug,
      metadata: skillData.skill.metadata,
      content: skillData.skill.content,
      path: '',
      source: 'global',
    }
  }, [skillData])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInFinder(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(t('common:skillInfo.deletedToast', { name: skill.metadata.name }))
      navigate(routes.view.skills())
    } catch (err) {
      toast.error(t('common:skillInfo.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common:unknownError'),
      })
    }
  }, [skill, workspaceId, skillSlug, t])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`workagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Get skill name for header
  const skillName = previewSkill?.metadata.name || skillSlug

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder with SKILL.md selected
  const handleLocationClick = () => {
    if (!skill) return
    // Show the SKILL.md file in Finder (this reveals the enclosing folder with file focused)
    window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!previewSkill && !loading && !error ? t('common:info.skillNotFound') : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={skill ? (
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            onDelete={handleDelete}
          />
        ) : undefined}
      />

      {previewSkill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={previewSkill} fluid workspaceId={workspaceId} />}
            title={previewSkill.metadata.name}
            tagline={previewSkill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title={t('common:skillInfo.metadataTitle')}
            actions={skill ? (
              // EditPopover for AI-assisted metadata editing (name, description in frontmatter)
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-metadata', skill.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            ) : undefined}
          >
            <Info_Table>
              <Info_Table.Row label={t('common:skillInfo.slugLabel')} value={previewSkill.slug} />
              <Info_Table.Row label={t('common:skillInfo.nameLabel')}>{previewSkill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label={t('common:skillInfo.descriptionLabel')}>
                {previewSkill.metadata.description}
              </Info_Table.Row>
              {skill && (
                <Info_Table.Row label={t('common:skillInfo.locationLabel')}>
                  <button
                    onClick={handleLocationClick}
                    className="hover:underline cursor-pointer text-left"
                  >
                    {formatPath(skill.path)}
                  </button>
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Variables */}
          {skill && skill.metadata.vars && skill.metadata.vars.length > 0 && (
            <SkillVariablesSection
              workspaceId={workspaceId}
              skillSlug={skillSlug}
              variables={skill.metadata.vars}
            />
          )}

          {/* Permission Modes */}
          {previewSkill.metadata.alwaysAllow && previewSkill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title={t('common:skillInfo.permissionModesTitle')}>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('common:skillInfo.permissionModesDescription')}
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">{t('common:skillInfo.permissionModeExplore')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">{t('common:skillInfo.permissionBlocked')}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('common:skillInfo.permissionModeAsk')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">{t('common:skillInfo.permissionAutoApproved')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('common:skillInfo.permissionModeAuto')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">{t('common:skillInfo.permissionNoEffect')}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title={t('common:skillInfo.instructionsTitle')}
            actions={skill ? (
              // EditPopover for AI-assisted editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-instructions', skill.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            ) : undefined}
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {previewSkill.content || `*${t('common:skillInfo.noInstructions')}*`}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
