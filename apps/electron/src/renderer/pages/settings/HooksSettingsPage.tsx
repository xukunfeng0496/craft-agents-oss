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

import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'

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
// Main Component
// ============================================

export default function HooksSettingsPage() {
  const { t } = useTranslation(['settings'])
  const labels = getHooksSettingsLabels(t)

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
                  <div className="p-4 text-muted-foreground text-sm">
                    Hooks management UI will be implemented here.
                  </div>
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
