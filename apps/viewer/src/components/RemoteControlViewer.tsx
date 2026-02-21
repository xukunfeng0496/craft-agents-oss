import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoredSession } from '@craft-agent/core'
import { SessionViewer } from '@craft-agent/ui'
import {
  PERMISSION_MODE_CONFIG,
  PERMISSION_MODE_ORDER,
  type PermissionMode,
} from '@craft-agent/shared/agent/mode-types'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@craft-agent/shared/agent/thinking-levels'

const PROCESSING_MESSAGES = [
  'Thinking...', 'Working on it...', 'Let me see...', 'One moment...',
  'Hold on...', 'Bear with me...', 'Just a sec...', 'Hang tight...',
  'Getting there...', 'Almost...', 'Working...', 'Busy busy...',
  'Crunching...', 'Brewing...', 'Connecting dots...', 'Hmm...',
]

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  return `${m}:${(seconds % 60).toString().padStart(2, '0')}`
}

function ProcessingIndicator({ startTime }: { startTime?: number }) {
  const [elapsed, setElapsed] = useState(0)
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * PROCESSING_MESSAGES.length))

  useEffect(() => {
    const start = startTime || Date.now()
    setElapsed(Math.floor((Date.now() - start) / 1000))
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startTime])

  useEffect(() => {
    const t = setInterval(() => {
      setMsgIdx(prev => {
        let next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        while (next === prev && PROCESSING_MESSAGES.length > 1) next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        return next
      })
    }, 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
      <span className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: '300ms' }} />
      </span>
      <span>{PROCESSING_MESSAGES[msgIdx]}</span>
      {elapsed >= 1 && <span className="text-muted-foreground/60 tabular-nums">{formatElapsed(elapsed)}</span>}
    </div>
  )
}

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

interface PendingPermission {
  requestId: string
  toolName: string
  command?: string
  description: string
  type?: string
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

function ModelThinkingButton({ model, availableModels, thinkingLevel, disabled, onModelChange, onThinkingChange }: {
  model: string | null
  availableModels: Array<{ id: string; name: string }>
  thinkingLevel: ThinkingLevel
  disabled: boolean
  onModelChange: (model: string) => void
  onThinkingChange: (level: ThinkingLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const currentModel = availableModels.find(m => m.id === model)
  const displayName = currentModel?.name ?? model ?? 'Model'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (availableModels.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-0.5 h-7 px-1.5 text-[13px] rounded-[6px] text-muted-foreground hover:bg-foreground/5 transition-colors disabled:opacity-40 select-none"
      >
        {displayName}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-50 min-w-[220px] rounded-lg border border-border bg-background shadow-lg py-1">
          {availableModels.map((m) => (
            <button
              key={m.id}
              onClick={() => { onModelChange(m.id); setOpen(false) }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${m.id === model ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <span>{m.name}</span>
              {m.id === model && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              )}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <div className="px-3 py-1 text-[11px] text-muted-foreground/60 uppercase tracking-wide">Thinking</div>
          {THINKING_LEVELS.map((tl) => (
            <button
              key={tl.id}
              onClick={() => { onThinkingChange(tl.id); setOpen(false) }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${tl.id === thinkingLevel ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <div className="text-left">
                <div className="font-medium text-sm">{tl.id === 'off' ? 'Off' : tl.id === 'think' ? 'Think' : 'Max'}</div>
                <div className="text-xs text-muted-foreground/70">{tl.description}</div>
              </div>
              {tl.id === thinkingLevel && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              )}
            </button>
          ))}
        </div>
      )}
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

function PermissionDialog({ permission, onRespond }: {
  permission: PendingPermission
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning shrink-0">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-sm font-medium">需要权限</span>
          {permission.type && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{permission.type}</span>
          )}
        </div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{permission.toolName}</div>
        {permission.command && (
          <pre className="mb-3 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs font-mono">{permission.command}</pre>
        )}
        <p className="mb-4 text-xs text-muted-foreground">{permission.description}</p>
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(true, false)}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            允许
          </button>
          <button
            onClick={() => onRespond(true, true)}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            始终允许
          </button>
          <button
            onClick={() => onRespond(false, false)}
            className="flex-1 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  )
}

export function RemoteControlViewer({ roomId, relayWsUrl }: Props) {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [config, setConfig] = useState<SessionConfig | null>(null)
  const [attachments, setAttachments] = useState<FileEntry[]>([])
  const [isAgentTyping, setIsAgentTyping] = useState(false)
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>(undefined)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
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
          case 'session_snapshot': {
            setSession(msg.session as StoredSession)
            const snapConfig = msg.config as SessionConfig | undefined
            if (snapConfig) {
              setConfig(snapConfig)
              if (snapConfig.isProcessing) {
                setProcessingStartTime(prev => prev ?? Date.now())
              } else {
                setProcessingStartTime(undefined)
              }
            }
            setIsAgentTyping(false)
            break
          }
          case 'text_delta':
            setIsAgentTyping(true)
            setConfig(prev => prev ? { ...prev, isProcessing: true } : prev)
            setProcessingStartTime(prev => prev ?? Date.now())
            break
          case 'complete':
            setIsAgentTyping(false)
            setConfig(prev => prev ? { ...prev, isProcessing: false } : prev)
            setPendingPermission(null)
            setProcessingStartTime(undefined)
            break
          case 'permission_request': {
            const req = msg.request as { requestId: string; toolName: string; command?: string; description: string; type?: string }
            if (req?.requestId) setPendingPermission(req)
            break
          }
          case 'permission_mode_changed':
            setConfig(prev => prev ? { ...prev, permissionMode: msg.permissionMode as PermissionMode } : prev)
            break
          case 'session_model_changed':
            setConfig(prev => prev ? { ...prev, model: msg.model as string | null } : prev)
            break
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

  const isDisabled = !connected
  const isProcessing = config?.isProcessing ?? false

  // --- Config Toolbar removed — controls moved into input box ---
  const toolbar = null

  // --- Footer (input area) ---
  const footer = (
    <div className="border-t border-border bg-background px-4 py-4">
      <div className="mx-auto max-w-[840px]">
        {isProcessing && (
          <div className="mb-3">
            <ProcessingIndicator startTime={processingStartTime} />
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
          className="relative flex flex-col rounded-xl border border-input bg-muted/30 px-4 pt-3 pb-2 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
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
          <div className="flex items-start gap-3">
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
              placeholder={isDisabled ? 'Connecting...' : 'Send a message...'}
              value={input}
              disabled={!!isDisabled}
              rows={3}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
            />
          </div>
          <div className="flex items-center pt-1">
            {config && (
              <PermissionModeBadge
                mode={config.permissionMode}
                disabled={!!isDisabled}
                onChange={(mode) => sendWsCommand({ type: 'set_permission_mode', mode })}
              />
            )}
            <div className="flex-1" />
            {config && (
              <ModelThinkingButton
                model={config.model}
                availableModels={config.availableModels}
                thinkingLevel={config.thinkingLevel}
                disabled={!!isDisabled}
                onModelChange={(model) => sendWsCommand({ type: 'set_model', model })}
                onThinkingChange={(level) => sendWsCommand({ type: 'set_thinking_level', level })}
              />
            )}
            {isProcessing ? (
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                onClick={() => sendWsCommand({ type: 'cancel_processing' })}
                aria-label="Stop"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              </button>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // --- Loading states ---
  if (!connected && !session) {
    return (
      <div className="flex h-[100dvh] items-center justify-center text-muted-foreground text-sm">
        Connecting to remote session...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-[100dvh] items-center justify-center text-muted-foreground text-sm">
        Waiting for session data...
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        {connected ? 'Connected — Remote Control' : 'Disconnected'}
      </div>
      {toolbar}
      <div className="relative flex-1 min-h-0">
        <SessionViewer
          session={session}
          mode="interactive"
          footer={footer}
          className="h-full"
        />
        {pendingPermission && (
          <PermissionDialog
            permission={pendingPermission}
            onRespond={(allowed, alwaysAllow) => {
              sendWsCommand({ type: 'permission_response', requestId: pendingPermission.requestId, allowed, alwaysAllow })
              setPendingPermission(null)
            }}
          />
        )}
      </div>
    </div>
  )
}
