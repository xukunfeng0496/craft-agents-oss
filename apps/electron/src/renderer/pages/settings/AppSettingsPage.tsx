/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { changeRendererLanguage } from '../../i18n'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

export function getSettingsLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:pageTitle'),
    notificationsTitle: t('settings:sections.notifications.title'),
    notificationsLabel: t('settings:sections.notifications.label'),
    notificationsDescription: t('settings:sections.notifications.description'),
    languageTitle: t('settings:sections.language.title'),
    languageDescription: t('settings:sections.language.description'),
    languageLabel: t('settings:sections.language.label'),
    languageOptionEnglish: t('settings:sections.language.options.english'),
    languageOptionChinese: t('settings:sections.language.options.chinese'),
    apiConnectionTitle: t('settings:sections.apiConnection.title'),
    apiConnectionDescription: t('settings:sections.apiConnection.description'),
    connectionTypeLabel: t('settings:sections.apiConnection.connectionType'),
    connectionTypeOauth: t('settings:sections.apiConnection.connectionTypeOauth'),
    connectionTypeApiKey: t('settings:sections.apiConnection.connectionTypeApiKey'),
    connectionTypeNone: t('settings:sections.apiConnection.connectionTypeNone'),
    editButton: t('settings:sections.apiConnection.editButton'),
    closeButton: t('settings:sections.apiConnection.closeButton'),
    aboutTitle: t('settings:sections.about.title'),
    versionLabel: t('settings:sections.about.versionLabel'),
    loadingVersion: t('settings:sections.about.loadingVersion'),
    checkForUpdatesLabel: t('settings:sections.about.checkForUpdatesLabel'),
    checkingLabel: t('settings:sections.about.checkingLabel'),
    checkNowLabel: t('settings:sections.about.checkNowLabel'),
    updateReadyLabel: t('settings:sections.about.updateReadyLabel'),
    restartToUpdateLabel: t('settings:sections.about.restartToUpdateLabel'),
    downloadingLabel: t('settings:sections.about.downloadingLabel'),
    downloadingProgressLabel: t('settings:sections.about.downloadingProgressLabel'),
  }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation(['settings'])
  const labels = getSettingsLabels(t)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Language state
  const [appLanguage, setAppLanguageState] = useState('en')

  // Auto-update state
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [notificationsOn, keepAwakeOn, storedLanguage] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getAppLanguage(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      setAppLanguageState(storedLanguage ?? 'en')
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  const handleLanguageChange = useCallback(async (value: string) => {
    setAppLanguageState(value)
    await window.electronAPI.setAppLanguage(value)
    await changeRendererLanguage(value)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Notifications */}
            <SettingsSection title={labels.notificationsTitle}>
              <SettingsCard>
                <SettingsToggle
                  label={labels.notificationsLabel}
                  description={labels.notificationsDescription}
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationsEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection title={labels.languageTitle} description={labels.languageDescription}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={labels.languageLabel}
                  value={appLanguage}
                  onValueChange={handleLanguageChange}
                  options={[
                    { value: 'en', label: labels.languageOptionEnglish },
                    { value: 'zh-CN', label: labels.languageOptionChinese },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Power */}
            <SettingsSection title="Power">
              <SettingsCard>
                <SettingsToggle
                  label="Keep screen awake"
                  description="Prevent the screen from turning off while sessions are running."
                  checked={keepAwakeEnabled}
                  onCheckedChange={handleKeepAwakeEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            {/* About */}
            <SettingsSection title={labels.aboutTitle}>
              <SettingsCard>
                <SettingsRow label={labels.versionLabel}>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {updateChecker.updateInfo?.currentVersion ?? labels.loadingVersion}
                    </span>
                    {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Spinner className="w-3 h-3" />
                        {updateChecker.isIndeterminate ? (
                          <span>{labels.downloadingLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion)}</span>
                        ) : (
                          <span>{labels.downloadingProgressLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion).replace('{{progress}}', String(updateChecker.downloadProgress))}</span>
                        )}
                      </div>
                    )}
                  </div>
                </SettingsRow>
                <SettingsRow label={labels.checkForUpdatesLabel}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <>
                        <Spinner className="mr-1.5" />
                        {labels.checkingLabel}
                      </>
                    ) : (
                      labels.checkNowLabel
                    )}
                  </Button>
                </SettingsRow>
                {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                  <SettingsRow label={labels.updateReadyLabel}>
                    <Button
                      size="sm"
                      onClick={updateChecker.installUpdate}
                    >
                      {labels.restartToUpdateLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion)}
                    </Button>
                  </SettingsRow>
                )}
              </SettingsCard>
            </SettingsSection>
          </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
