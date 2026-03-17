import React, { useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserEmptyStateCard } from '@work-agent/ui'
import { routes } from '../shared/routes'
import { EMPTY_STATE_PROMPT_SAMPLES } from './components/browser/empty-state-prompts'
import './index.css'

function BrowserEmptyStateApp() {
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
          title="这个浏览器已经准备好为你的 Agents 服务了 ;)"
          description="你可以让任意会话使用这个浏览器（或再打开一个新窗口）来完成信息检索、表单填写、QA 检查、数据提取等任务。"
          prompts={EMPTY_STATE_PROMPT_SAMPLES}
          showExamplePrompts={true}
          showSafetyHint={true}
          onPromptSelect={(sample) => handlePromptSelect(sample.full)}
        />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserEmptyStateApp />
  </React.StrictMode>,
)
