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
  }

  const footer = (
    <div className="flex gap-2 p-3 border-t border-border">
      <input
        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        placeholder={connected ? 'Send a message...' : 'Connecting...'}
        value={input}
        disabled={!connected}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
          }
        }}
      />
      <button
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        disabled={!connected || !input.trim()}
        onClick={sendMessage}
      >
        Send
      </button>
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
        {connected ? 'Connected' : 'Disconnected'}
      </div>
      <SessionViewer
        session={session}
        mode="interactive"
        footer={footer}
        className="flex-1 min-h-0"
      />
      {isAgentTyping && (
        <div className="px-4 py-1 text-xs text-muted-foreground animate-pulse">
          Agent is typing...
        </div>
      )}
    </div>
  )
}
