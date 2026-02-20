import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoredSession } from '@craft-agent/core'
import type { UserQuestion } from '@craft-agent/core/types'
import { SessionViewer, UserQuestionCard } from '@craft-agent/ui'
import {
  PERMISSION_MODE_CONFIG,
  PERMISSION_MODE_ORDER,
  type PermissionMode,
} from '@craft-agent/shared/agent/mode-types'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@craft-agent/shared/agent/thinking-levels'

interface Props {
  roomId: string
  relayWsUrl: string
}

interface SessionConfig {
  permissionMode: PermissionMode
  thinkingLevel: ThinkingLevel
  model: string | null
  connectionLocked: boolean
  isProcessing: boolean
  availableModels: Array<{ id: string; name: string }>
}

interface FileEntry {
  file: File
  base64: string
  type: string
  preview?: string
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_FILES = 5

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1]) // strip data:...;base64, prefix
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function inferFileType(file: File): string {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('text/') || file.name.match(/\.(ts|tsx|js|jsx|json|md|py|rs|go|java|c|cpp|h|css|html|xml|yaml|yml|toml|sh|sql)$/i)) return 'text'
  return 'unknown'
}

// --- Sub-components ---

function PermissionModeBadge({ mode, disabled, onChange }: {
  mode: PermissionMode
  disabled: boolean
  onChange: (mode: PermissionMode) => void
}) {
  const config = PERMISSION_MODE_CONFIG[mode]
  const cycle = () => {
    if (disabled) return
    const idx = PERMISSION_MODE_ORDER.indexOf(mode)
    onChange(PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length])
  }
  return (
    <button
      onClick={cycle}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50 ${config.colorClass.text}`}
      title={config.description}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={config.svgPath} />
      </svg>
      {config.shortName}
    </button>
  )
}

function ModelDropdown({ model, availableModels, disabled, onChange }: {
  model: string | null
  availableModels: Array<{ id: string; name: string }>
  disabled: boolean
  onChange: (model: string) => void
}) {
  if (availableModels.length === 0) return null
  return (
    <select
      value={model ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-ring disabled:opacity-50"
    >
      {availableModels.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  )
}

function ThinkingLevelControl({ level, onChange }: {
  level: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}) {
  return (
    <div className="flex rounded-md border border-border">
      {THINKING_LEVELS.map((tl) => (
        <button
          key={tl.id}
          onClick={() => onChange(tl.id)}
          title={tl.description}
          className={`px-2 py-1 text-xs transition-colors first:rounded-l-md last:rounded-r-md ${
            level === tl.id
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          }`}
        >
          {tl.id === 'off' ? 'Off' : tl.id === 'think' ? 'Think' : 'Max'}
        </button>
      ))}
    </div>
  )
}

function AttachmentPreview({ entries, onRemove }: {
  entries: FileEntry[]
  onRemove: (index: number) => void
}) {
  if (entries.length === 0) return null
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pb-2">
      {entries.map((entry, i) => (
        <div key={i} className="group relative flex-shrink-0">
          {entry.preview ? (
            <img src={entry.preview} alt={entry.file.name} className="h-12 w-12 rounded-md object-cover border border-border" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
              {entry.file.name.split('.').pop()?.toUpperCase() ?? '?'}
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Remove file"
          >
            ×
          </button>
          <div className="mt-0.5 max-w-[48px] truncate text-[10px] text-muted-foreground">{entry.file.name}</div>
        </div>
      ))}
    </div>
  )
}

// --- Main Component ---

export function RemoteControlViewer({ roomId, relayWsUrl }: Props) {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [config, setConfig] = useState<SessionConfig | null>(null)
  const [attachments, setAttachments] = useState<FileEntry[]>([])
  const [isAgentTyping, setIsAgentTyping] = useState(false)
  const [pendingQuestions, setPendingQuestions] = useState<Array<{
    requestId: string
    sessionId: string
    questions: UserQuestion[]
  }>>([])
  const wsRef = useRef<WebSocket | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const sendWsCommand = useCallback((cmd: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  useEffect(() => {
    const ws = new WebSocket(`${relayWsUrl}/rooms/${roomId}/ws?role=viewer`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown }
        switch (msg.type) {
          case 'session_snapshot':
            setSession(msg.session as StoredSession)
            if (msg.config) setConfig(msg.config as SessionConfig)
            setIsAgentTyping(false)
            break
          case 'text_delta':
            setIsAgentTyping(true)
            setConfig(prev => prev ? { ...prev, isProcessing: true } : prev)
            break
          case 'complete':
            setIsAgentTyping(false)
            setConfig(prev => prev ? { ...prev, isProcessing: false } : prev)
            break
          case 'permission_mode_changed':
            setConfig(prev => prev ? { ...prev, permissionMode: msg.permissionMode as PermissionMode } : prev)
            break
          case 'session_model_changed':
            setConfig(prev => prev ? { ...prev, model: msg.model as string | null } : prev)
            break
          case 'user_question_request': {
            const req = msg.request as { requestId: string; sessionId: string; questions: UserQuestion[] }
            if (req?.requestId && req.questions) {
              setPendingQuestions(prev => [...prev, req])
            }
            break
          }
          case 'question_answered': {
            const answeredRequestId = msg.requestId as string
            if (answeredRequestId) {
              setPendingQuestions(prev => prev.filter(q => q.requestId !== answeredRequestId))
            }
            break
          }
        }
      } catch {}
    }

    return () => ws.close()
  }, [roomId, relayWsUrl])

  // File processing
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const remaining = MAX_FILES - attachments.length
    const toProcess = Array.from(files).slice(0, remaining)
    const results: FileEntry[] = []
    for (const file of toProcess) {
      if (file.size > MAX_FILE_SIZE) continue
      const base64 = await readFileAsBase64(file)
      const type = inferFileType(file)
      const preview = type === 'image' ? URL.createObjectURL(file) : undefined
      results.push({ file, base64, type, preview })
    }
    setAttachments(prev => [...prev, ...results])
  }, [attachments.length])

  const sendMessage = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const payload: Record<string, unknown> = {
      type: 'send_message',
      content: input.trim() || '(attached files)',
    }
    if (attachments.length > 0) {
      payload.attachments = attachments.map(a => ({
        type: a.type,
        name: a.file.name,
        mimeType: a.file.type,
        base64: a.base64,
        size: a.file.size,
      }))
    }
    wsRef.current.send(JSON.stringify(payload))
    setInput('')
    setAttachments(prev => {
      prev.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
      return []
    })
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, attachments])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files)
  }, [processFiles])

  const isDisabled = !connected || config?.isProcessing

  // --- Config Toolbar ---
  const toolbar = config ? (
    <div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
      <PermissionModeBadge
        mode={config.permissionMode}
        disabled={!!isDisabled}
        onChange={(mode) => sendWsCommand({ type: 'set_permission_mode', mode })}
      />
      <ModelDropdown
        model={config.model}
        availableModels={config.availableModels}
        disabled={!!isDisabled}
        onChange={(model) => sendWsCommand({ type: 'set_model', model })}
      />
      <ThinkingLevelControl
        level={config.thinkingLevel}
        onChange={(level) => sendWsCommand({ type: 'set_thinking_level', level })}
      />
    </div>
  ) : null

  // --- Footer (input area) ---
  const footer = (
    <div className="border-t border-border bg-background px-4 py-4">
      <div className="mx-auto max-w-3xl">
        {pendingQuestions.length > 0 && (
          <div className="mb-3">
            <UserQuestionCard
              request={pendingQuestions[0]}
              onSubmit={(requestId, answers) => {
                sendWsCommand({ type: 'respond_to_question', requestId, answers })
                // Optimistically dismiss; question_answered event will confirm
                setPendingQuestions(prev => prev.slice(1))
              }}
            />
          </div>
        )}
        <AttachmentPreview
          entries={attachments}
          onRemove={(i) => setAttachments(prev => {
            const next = [...prev]
            const removed = next.splice(i, 1)[0]
            if (removed.preview) URL.revokeObjectURL(removed.preview)
            return next
          })}
        />
        <div
          className="relative flex items-end gap-3 rounded-xl border border-input bg-muted/30 px-4 py-3 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) processFiles(e.target.files); e.target.value = '' }}
          />
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            disabled={!!isDisabled || attachments.length >= MAX_FILES}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground/60"
            placeholder={isDisabled ? (config?.isProcessing ? 'Agent is working...' : 'Connecting...') : 'Send a message...'}
            value={input}
            disabled={!!isDisabled}
            rows={1}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
          />
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            disabled={!!isDisabled || (!input.trim() && attachments.length === 0)}
            onClick={sendMessage}
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        {isAgentTyping && (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '300ms' }} />
            </span>
            Agent is thinking...
          </div>
        )}
      </div>
    </div>
  )

  // --- Loading states ---
  if (!connected && !session) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
        Connecting to remote session...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
        Waiting for session data...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        {connected ? 'Connected — Remote Control' : 'Disconnected'}
      </div>
      {toolbar}
      <SessionViewer
        session={session}
        mode="interactive"
        footer={footer}
        className="flex-1 min-h-0"
      />
    </div>
  )
}
