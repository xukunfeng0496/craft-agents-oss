import { useEffect, useRef, useState } from 'react'
import type { StoredSession } from '@craft-agent/core'
import { SessionViewer } from '@craft-agent/ui'

interface Props {
  roomId: string
  relayWsUrl: string
}

export function RemoteControlViewer({ roomId, relayWsUrl }: Props) {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isAgentTyping, setIsAgentTyping] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(`${relayWsUrl}/rooms/${roomId}/ws?role=viewer`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown }
        if (msg.type === 'session_snapshot') {
          setSession(msg.session as StoredSession)
          setIsAgentTyping(false)
        } else if (msg.type === 'text_delta') {
          setIsAgentTyping(true)
        } else if (msg.type === 'complete') {
          setIsAgentTyping(false)
        }
      } catch {}
    }

    return () => ws.close()
  }, [roomId, relayWsUrl])

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'send_message', content: input.trim() }))
    setInput('')
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const footer = (
    <div className="border-t border-border bg-background px-4 py-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end gap-3 rounded-xl border border-input bg-muted/30 px-4 py-3 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground/60"
            placeholder={connected ? 'Send a message...' : 'Connecting...'}
            value={input}
            disabled={!connected}
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
            disabled={!connected || !input.trim()}
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
      <SessionViewer
        session={session}
        mode="interactive"
        footer={footer}
        className="flex-1 min-h-0"
      />
    </div>
  )
}
