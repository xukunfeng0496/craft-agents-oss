// apps/electron/src/renderer/components/onboarding/MissingToolsStep.tsx
import { useState, useEffect } from 'react'
import { Wrench, Check, Copy, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import { useTranslation } from 'react-i18next'
import type { MissingTool, ToolInstallProgress } from '../../../shared/types'

type InstallChoice = 'auto' | 'manual'

interface ToolUiState {
  choice: InstallChoice
  status: 'idle' | 'downloading' | 'launching' | 'launched' | 'error' | 'rechecking'
  downloadPercent: number
  downloadedMB: number
  totalMB: number
  error?: string
  found: boolean
}

interface MissingToolsStepProps {
  tools: MissingTool[]
  platform: 'win32' | 'darwin' | 'linux'
  linuxDistro?: 'apt' | 'yum' | 'pacman' | 'default'
  onInstall: (toolId: 'git' | 'python') => void
  onRecheck: (toolId: 'git' | 'python') => void
  onContinue: () => void
  onBack: () => void
  installProgress?: ToolInstallProgress
}

const MANUAL_URLS = {
  git: {
    win32: 'https://git-scm.com/downloads/win',
    darwin: 'https://git-scm.com/downloads/mac',
    linux: 'https://git-scm.com/downloads/linux',
  },
  python: {
    win32: 'https://www.python.org/downloads/windows/',
    darwin: 'https://www.python.org/downloads/macos/',
    linux: 'https://www.python.org/downloads/',
  },
}

export function MissingToolsStep({
  tools,
  platform,
  linuxDistro = 'default',
  onInstall,
  onRecheck,
  onContinue,
  onBack,
  installProgress,
}: MissingToolsStepProps) {
  const { t } = useTranslation(['onboarding'])

  // Per-tool local UI state
  const [toolState, setToolState] = useState<Record<string, ToolUiState>>(() => {
    const initial: Record<string, ToolUiState> = {}
    for (const tool of tools) {
      initial[tool.id] = {
        choice: 'auto',
        status: 'idle',
        downloadPercent: 0,
        downloadedMB: 0,
        totalMB: 0,
        found: tool.found,
      }
    }
    return initial
  })

  // Apply incoming progress events from parent
  useEffect(() => {
    if (!installProgress) return
    const { toolId, status, percent, downloadedMB, totalMB, error } = installProgress
    setToolState(prev => ({
      ...prev,
      [toolId]: {
        ...prev[toolId],
        status: status === 'done' ? 'launched' : status === 'launching' ? 'launching' : status === 'error' ? 'error' : 'downloading',
        downloadPercent: percent ?? prev[toolId].downloadPercent,
        downloadedMB: downloadedMB ?? prev[toolId].downloadedMB,
        totalMB: totalMB ?? prev[toolId].totalMB,
        error,
      },
    }))
  }, [installProgress])

  const handleInstall = (toolId: 'git' | 'python') => {
    setToolState(prev => ({
      ...prev,
      [toolId]: { ...prev[toolId], status: 'downloading', downloadPercent: 0, error: undefined },
    }))
    onInstall(toolId)
  }

  const handleRecheck = (toolId: 'git' | 'python') => {
    setToolState(prev => ({ ...prev, [toolId]: { ...prev[toolId], status: 'rechecking' } }))
    onRecheck(toolId)
  }

  const handleCopyCommand = (command: string) => {
    navigator.clipboard.writeText(command)
  }

  // Update found state when recheck completes (tools prop changes)
  useEffect(() => {
    setToolState(prev => {
      const next = { ...prev }
      for (const tool of tools) {
        if (next[tool.id] && tool.found && !next[tool.id].found) {
          next[tool.id] = { ...next[tool.id], found: true, status: 'idle' }
        }
      }
      return next
    })
  }, [tools])

  const allFound = tools.every(t => toolState[t.id]?.found || t.found)

  return (
    <StepFormLayout
      icon={<Wrench />}
      title={t('onboarding:missingTools.title')}
      description={t('onboarding:missingTools.description')}
    >
      <div className="space-y-3">
        {tools.map(tool => {
          const state = toolState[tool.id]
          const isFound = state?.found || tool.found

          return (
            <div
              key={tool.id}
              className="rounded-lg border border-border bg-foreground-2 p-4"
            >
              {/* Tool header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t(`onboarding:missingTools.tools.${tool.id}.name`)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(`onboarding:missingTools.tools.${tool.id}.description`)}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  isFound
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}>
                  {isFound
                    ? t('onboarding:missingTools.status.found')
                    : t('onboarding:missingTools.status.missing')}
                </span>
              </div>

              {/* Actions: only shown when not found */}
              {!isFound && (
                <div className="mt-3">
                  {/* Linux: show terminal command */}
                  {platform === 'linux' ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t('onboarding:missingTools.linux.note')}
                      </p>
                      <div className="flex items-center gap-2 rounded bg-background px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-foreground">
                          {t(`onboarding:missingTools.linux.commands.${tool.id}.${linuxDistro}`)}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyCommand(
                            t(`onboarding:missingTools.linux.commands.${tool.id}.${linuxDistro}`)
                          )}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleRecheck(tool.id)}
                        disabled={state?.status === 'rechecking'}
                        className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        <RefreshCw className={`mr-2 size-3 ${state?.status === 'rechecking' ? 'animate-spin' : ''}`} />
                        {state?.status === 'rechecking'
                          ? t('onboarding:missingTools.rechecking')
                          : t('onboarding:missingTools.recheck')}
                      </Button>
                    </div>
                  ) : (
                    /* Windows / macOS: auto-install or manual */
                    <div className="space-y-3">
                      {/* Choice radio buttons */}
                      {state?.status === 'idle' && (
                        <div className="space-y-2">
                          {/* Auto install option */}
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`install-choice-${tool.id}`}
                              value="auto"
                              checked={state.choice === 'auto'}
                              onChange={() => setToolState(prev => ({
                                ...prev,
                                [tool.id]: { ...prev[tool.id], choice: 'auto' }
                              }))}
                              className="mt-0.5"
                            />
                            <span className="text-xs text-foreground">
                              {t('onboarding:missingTools.autoInstall')}
                            </span>
                          </label>

                          {/* Manual install option */}
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`install-choice-${tool.id}`}
                              value="manual"
                              checked={state.choice === 'manual'}
                              onChange={() => setToolState(prev => ({
                                ...prev,
                                [tool.id]: { ...prev[tool.id], choice: 'manual' }
                              }))}
                              className="mt-0.5"
                            />
                            <span className="text-xs text-foreground">
                              {t('onboarding:missingTools.manualInstall')}
                            </span>
                          </label>
                        </div>
                      )}

                      {/* Manual install: show link + re-check */}
                      {state?.choice === 'manual' && state?.status === 'idle' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => window.electronAPI.openUrl(
                              MANUAL_URLS[tool.id][platform as 'win32' | 'darwin'] ?? MANUAL_URLS[tool.id].linux
                            )}
                            className="flex-1 bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <ExternalLink className="mr-2 size-3" />
                            {t('onboarding:missingTools.openDownloadPage')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleRecheck(tool.id)}
                            className="flex-1 bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <RefreshCw className="mr-2 size-3" />
                            {t('onboarding:missingTools.recheck')}
                          </Button>
                        </div>
                      )}

                      {/* Auto install: show install button */}
                      {state?.choice === 'auto' && state?.status === 'idle' && (
                        <Button
                          size="sm"
                          onClick={() => handleInstall(tool.id)}
                          className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                        >
                          {t('onboarding:missingTools.autoInstall')}
                        </Button>
                      )}

                      {/* Downloading progress */}
                      {state?.status === 'downloading' && (
                        <div className="space-y-1">
                          <div className="h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all"
                              style={{ width: `${state.downloadPercent}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('onboarding:missingTools.downloadProgress', {
                              percent: state.downloadPercent,
                              downloadedMB: state.downloadedMB,
                              totalMB: state.totalMB,
                            })}
                          </p>
                        </div>
                      )}

                      {/* Launching */}
                      {state?.status === 'launching' && (
                        <p className="text-xs text-muted-foreground">
                          {t('onboarding:missingTools.launching')}
                        </p>
                      )}

                      {/* Installer launched: show re-check */}
                      {state?.status === 'launched' && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {t('onboarding:missingTools.installerLaunched')}
                          </p>
                          <Button
                            size="sm"
                            onClick={() => handleRecheck(tool.id)}
                            className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            <RefreshCw className="mr-2 size-3" />
                            {t('onboarding:missingTools.recheck')}
                          </Button>
                        </div>
                      )}

                      {/* Rechecking */}
                      {state?.status === 'rechecking' && (
                        <Button
                          size="sm"
                          disabled
                          className="w-full bg-background shadow-minimal text-foreground rounded-lg"
                        >
                          <RefreshCw className="mr-2 size-3 animate-spin" />
                          {t('onboarding:missingTools.rechecking')}
                        </Button>
                      )}

                      {/* Error */}
                      {state?.status === 'error' && (
                        <div className="space-y-2">
                          <p className="text-xs text-destructive">
                            {t('onboarding:missingTools.installError', { error: state.error })}
                          </p>
                          <Button
                            size="sm"
                            onClick={() => setToolState(prev => ({
                              ...prev,
                              [tool.id]: { ...prev[tool.id], status: 'idle', error: undefined }
                            }))}
                            className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t('onboarding:missingTools.recheck')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Found: show checkmark */}
              {isFound && (
                <div className="mt-2 flex items-center gap-1.5 text-success">
                  <Check className="size-3" />
                  <span className="text-xs">{t('onboarding:missingTools.status.found')}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer actions */}
      <div className="mt-6 flex gap-3 justify-center">
        <BackButton onClick={onBack}>
          {t('onboarding:missingTools.back')}
        </BackButton>
        <ContinueButton onClick={onContinue}>
          {allFound
            ? t('onboarding:missingTools.continue')
            : t('onboarding:missingTools.skip')}
        </ContinueButton>
      </div>
    </StepFormLayout>
  )
}
