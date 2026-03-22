/**
 * Browser Toolbar — React entry point
 *
 * Renders the shared BrowserControls component inside a chromeless
 * BrowserWindow. Communicates with the main process via a dedicated
 * preload script (browser-toolbar preload).
 */

import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrowserControls } from '@work-agent/ui'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { initRendererI18n } from './i18n'
import './index.css'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ToolbarState {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  themeColor?: string | null
}

declare global {
  interface Window {
    browserToolbar: {
      instanceId: string
      navigate: (url: string) => Promise<void>
      goBack: () => Promise<void>
      goForward: () => Promise<void>
      reload: () => Promise<void>
      stop: () => Promise<void>
      openWindowMenu: (x: number, y: number) => Promise<void>
      hideWindow: () => Promise<void>
      closeWindowEntirely: () => Promise<void>
      onStateUpdate: (callback: (state: ToolbarState) => void) => () => void
      onThemeColor: (callback: (color: string | null) => void) => () => void
    }
  }
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

function BrowserToolbarApp() {
  const { t } = useTranslation()
  const [state, setState] = useState<ToolbarState>({
    url: 'about:blank',
    title: t('browser.newTab'),
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  })
  const [themeColor, setThemeColor] = useState<string | null>(null)

  const api = window.browserToolbar

  useEffect(() => {
    if (!api) return
    return api.onStateUpdate((s) => {
      setState(s)
      // Sync theme color from full state push (initial load / reconnection)
      if ('themeColor' in s) {
        setThemeColor((s as ToolbarState).themeColor ?? null)
      }
    })
  }, [api])

  useEffect(() => {
    if (!api) return
    return api.onThemeColor(setThemeColor)
  }, [api])

  const handleNavigate = useCallback((url: string) => {
    void api?.navigate(url)
  }, [api])

  const handleGoBack = useCallback(() => {
    void api?.goBack()
  }, [api])

  const handleGoForward = useCallback(() => {
    void api?.goForward()
  }, [api])

  const handleReload = useCallback(() => {
    void api?.reload()
  }, [api])

  const handleStop = useCallback(() => {
    void api?.stop()
  }, [api])

  const handleCloseWindow = useCallback(() => {
    void api?.closeWindowEntirely()
  }, [api])

  return (
    <BrowserControls
      url={state.url}
      loading={state.isLoading}
      canGoBack={state.canGoBack}
      canGoForward={state.canGoForward}
      onNavigate={handleNavigate}
      onGoBack={handleGoBack}
      onGoForward={handleGoForward}
      onReload={handleReload}
      onStop={handleStop}
      labels={{
        back: t('browser.back'),
        forward: t('browser.forward'),
        stopLoading: t('browser.stopLoading'),
        reload: t('browser.reload'),
        urlPlaceholder: t('browser.urlPlaceholder'),
      }}
      trailingContent={(
        <div className="ml-2 flex items-center gap-1.5">
          <HeaderIconButton
            icon={<X className="h-3.5 w-3.5" />}
            aria-label={t('browser.closeBrowserWindow')}
            tooltip={t('browser.closeWindow')}
            className={themeColor ? '' : 'bg-background shadow-minimal hover:bg-foreground/5'}
            style={themeColor ? { color: 'var(--tb-fg)' } : undefined}
            onClick={handleCloseWindow}
          />
        </div>
      )}
      themeColor={themeColor}
      urlBarClassName="max-w-[600px]"
      className="titlebar-drag-region"
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */

async function bootstrap() {
  await initRendererI18n({ namespaces: ['common'] }).catch((error) => {
    console.error('Failed to initialize browser toolbar i18n:', error)
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserToolbarApp />
    </React.StrictMode>,
  )
}

void bootstrap()
