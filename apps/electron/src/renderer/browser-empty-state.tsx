import React, { useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { BrowserEmptyStateCard } from '@work-agent/ui'
import { routes } from '../shared/routes'
import { getEmptyStatePromptSamples } from './components/browser/empty-state-prompts'
import { initRendererI18n } from './i18n'
import './index.css'

function BrowserEmptyStateApp() {
  const { t, i18n } = useTranslation()
  const prompts = getEmptyStatePromptSamples(i18n.language)
  const handlePromptSelect = useCallback(async (fullPrompt: string) => {
    const route = routes.action.newSession({ input: fullPrompt, send: true })
    const token = String(Date.now())

    try {
      if (window.electronAPI?.browserPane?.emptyStateLaunch) {
        await window.electronAPI.browserPane.emptyStateLaunch({ route, token })
        return
      }
    } catch {
      // Fallback to hash-signaling below if IPC route fails for any reason.
    }

    const launchParams = new URLSearchParams({ route, ts: token })
    window.location.hash = `launch=${launchParams.toString()}`
  }, [])

  return (
    <div className="h-screen w-screen bg-foreground-2 overflow-hidden">
      <div className="h-full w-full bg-background overflow-auto">
        <BrowserEmptyStateCard
          title={t('browser.emptyStateTitle')}
          description={t('browser.emptyStateDescription')}
          prompts={prompts}
          showExamplePrompts={true}
          showSafetyHint={true}
          safetyHintText={t('browser.safetyHint')}
          onPromptSelect={(sample) => handlePromptSelect(sample.full)}
        />
      </div>
    </div>
  )
}

async function bootstrap() {
  await initRendererI18n({ namespaces: ['common'] }).catch((error) => {
    console.error('Failed to initialize browser empty state i18n:', error)
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserEmptyStateApp />
    </React.StrictMode>,
  )
}

void bootstrap()
