# Remote Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Remote Control" toggle to sessions that establishes a WebSocket relay connection, generates a public URL, and lets a remote browser user send messages to and see live output from the local agent session.

**Architecture:** A new `packages/relay-server` Bun WebSocket server acts as the relay between the Electron app and the remote browser. When remote control is enabled, the Electron main process connects to the relay via WebSocket, registers a room, and streams all `SessionEvent`s to it. The viewer app gains a new `/r/{roomId}` route that connects to the same relay room and renders live updates plus an input box for sending messages back.

**Tech Stack:** Bun WebSocket server, `ws` (or native Bun WebSocket), React + existing `SessionViewer` component (already has `interactive` mode + `footer` prop), existing IPC/SessionCommand pattern, existing `@work-agent/shared/sessions` types.

---

## Task 1: Relay Server — core WebSocket room logic

**Files:**
- Create: `packages/relay-server/package.json`
- Create: `packages/relay-server/src/index.ts`
- Create: `packages/relay-server/src/room-manager.ts`

**Step 1: Create package.json**

```json
{
  "name": "@work-agent/relay-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**Step 2: Create tsconfig.json**

Create `packages/relay-server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create room-manager.ts**

```typescript
// packages/relay-server/src/room-manager.ts
import { randomBytes } from 'crypto'

export type RoomRole = 'owner' | 'viewer'

export interface RoomClient {
  ws: WebSocket
  role: RoomRole
}

export interface Room {
  id: string
  clients: Set<RoomClient>
  /** Buffered events so late-joining viewers get current state */
  eventBuffer: string[]
  createdAt: number
}

const MAX_BUFFER = 500
const ROOM_TTL_MS = 24 * 60 * 60 * 1000 // 24h

export class RoomManager {
  private rooms = new Map<string, Room>()

  createRoom(): Room {
    const id = randomBytes(8).toString('hex')
    const room: Room = { id, clients: new Set(), eventBuffer: [], createdAt: Date.now() }
    this.rooms.set(id, room)
    return room
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  addClient(roomId: string, ws: WebSocket, role: RoomRole): RoomClient | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    const client: RoomClient = { ws, role }
    room.clients.add(client)
    return client
  }

  removeClient(roomId: string, client: RoomClient): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.clients.delete(client)
    // If owner disconnects, close all viewer connections
    if (client.role === 'owner') {
      for (const c of room.clients) {
        c.ws.close(1000, 'owner_disconnected')
      }
      this.rooms.delete(roomId)
    }
  }

  broadcast(room: Room, message: string, excludeRole?: RoomRole): void {
    for (const client of room.clients) {
      if (excludeRole && client.role === excludeRole) continue
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message)
      }
    }
  }

  bufferEvent(room: Room, message: string): void {
    room.eventBuffer.push(message)
    if (room.eventBuffer.length > MAX_BUFFER) {
      room.eventBuffer.shift()
    }
  }

  /** Prune rooms older than TTL with no clients */
  pruneStale(): void {
    const now = Date.now()
    for (const [id, room] of this.rooms) {
      if (room.clients.size === 0 && now - room.createdAt > ROOM_TTL_MS) {
        this.rooms.delete(id)
      }
    }
  }
}
```

**Step 4: Create index.ts (WebSocket server)**

```typescript
// packages/relay-server/src/index.ts
import { RoomManager } from './room-manager'

const PORT = parseInt(process.env.PORT ?? '4747')
const RELAY_SECRET = process.env.RELAY_SECRET ?? ''
const manager = new RoomManager()

// Prune stale rooms every hour
setInterval(() => manager.pruneStale(), 60 * 60 * 1000)

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url)

    // POST /rooms — create a new room (owner only, requires secret)
    if (req.method === 'POST' && url.pathname === '/rooms') {
      if (RELAY_SECRET && req.headers.get('x-relay-secret') !== RELAY_SECRET) {
        return new Response('Unauthorized', { status: 401 })
      }
      const room = manager.createRoom()
      return Response.json({ roomId: room.id })
    }

    // GET /rooms/:id/ws?role=owner|viewer — upgrade to WebSocket
    const wsMatch = url.pathname.match(/^\/rooms\/([a-f0-9]+)\/ws$/)
    if (wsMatch) {
      const roomId = wsMatch[1]
      const role = url.searchParams.get('role') === 'owner' ? 'owner' : 'viewer'

      if (role === 'owner' && RELAY_SECRET) {
        if (req.headers.get('x-relay-secret') !== RELAY_SECRET) {
          return new Response('Unauthorized', { status: 401 })
        }
      }

      const room = manager.getRoom(roomId)
      if (!room) return new Response('Room not found', { status: 404 })

      const upgraded = server.upgrade(req, { data: { roomId, role } })
      if (!upgraded) return new Response('WebSocket upgrade failed', { status: 500 })
      return undefined as unknown as Response
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  },

  websocket: {
    open(ws) {
      const { roomId, role } = ws.data as { roomId: string; role: 'owner' | 'viewer' }
      const client = manager.addClient(roomId, ws as unknown as WebSocket, role)
      if (!client) {
        ws.close(1008, 'room_not_found')
        return
      }

      // Send buffered events to new viewer so they get current state
      if (role === 'viewer') {
        const room = manager.getRoom(roomId)!
        for (const event of room.eventBuffer) {
          ws.send(event)
        }
      }
    },

    message(ws, message) {
      const { roomId, role } = ws.data as { roomId: string; role: 'owner' | 'viewer' }
      const room = manager.getRoom(roomId)
      if (!room) return

      const raw = typeof message === 'string' ? message : message.toString()

      if (role === 'owner') {
        // Owner → buffer + broadcast to viewers
        manager.bufferEvent(room, raw)
        manager.broadcast(room, raw, 'owner')
      } else {
        // Viewer → forward command to owner only
        for (const client of room.clients) {
          if (client.role === 'owner' && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(raw)
          }
        }
      }
    },

    close(ws) {
      const { roomId, role } = ws.data as { roomId: string; role: 'owner' | 'viewer' }
      const room = manager.getRoom(roomId)
      if (!room) return
      for (const client of room.clients) {
        if (client.ws === (ws as unknown as WebSocket)) {
          manager.removeClient(roomId, client)
          break
        }
      }
    },
  },
})

console.log(`Relay server running on port ${server.port}`)
```

**Step 5: Add to root package.json workspaces** (already covered by `packages/*` glob — no change needed)

**Step 6: Test manually**

```bash
cd packages/relay-server
bun run src/index.ts &
# Create room
curl -X POST http://localhost:4747/rooms
# Expected: {"roomId":"<hex>"}
```

**Step 7: Commit**

```bash
git add packages/relay-server/
git commit -m "feat: add relay-server package for WebSocket room relay"
```

---

## Task 2: Session types — add remote control fields

**Files:**
- Modify: `packages/shared/src/sessions/types.ts`

**Step 1: Add fields to SESSION_PERSISTENT_FIELDS**

In `packages/shared/src/sessions/types.ts`, find the `SESSION_PERSISTENT_FIELDS` array and add after the sharing fields (`'sharedUrl', 'sharedId'`):

```typescript
// Remote control
'remoteRoomId', 'remoteUrl',
```

**Step 2: Add fields to SessionConfig interface**

After the existing sharing fields (`sharedUrl?: string`, `sharedId?: string`), add:

```typescript
/** Remote control room ID (relay server) */
remoteRoomId?: string
/** Remote control public URL */
remoteUrl?: string
```

**Step 3: Type-check**

```bash
cd packages/shared && bun run tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add packages/shared/src/sessions/types.ts
git commit -m "feat: add remoteRoomId/remoteUrl fields to SessionConfig"
```

---

## Task 3: SessionCommand — add remote control commands

**Files:**
- Modify: `apps/electron/src/shared/types.ts`

**Step 1: Add commands to SessionCommand union**

Find the `SessionCommand` type and add three new variants alongside the existing share commands:

```typescript
| { type: 'startRemoteControl' }
| { type: 'stopRemoteControl' }
```

**Step 2: Add SessionEvent variants**

Find the `SessionEvent` type and add:

```typescript
| { type: 'remote_control_started'; sessionId: string; remoteUrl: string }
| { type: 'remote_control_stopped'; sessionId: string }
```

**Step 3: Type-check**

```bash
cd apps/electron && bun run tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add apps/electron/src/shared/types.ts
git commit -m "feat: add remote control commands and events to shared types"
```

---

## Task 4: Electron main — relay client + session streaming

**Files:**
- Modify: `apps/electron/src/main/sessions.ts`

**Step 1: Add relay config constants near top of sessions.ts**

After the existing imports, add:

```typescript
const RELAY_URL = process.env.RELAY_URL ?? 'ws://localhost:4747'
const RELAY_HTTP_URL = RELAY_URL.replace(/^ws/, 'http')
const RELAY_SECRET = process.env.RELAY_SECRET ?? ''
const RELAY_PUBLIC_BASE = process.env.RELAY_PUBLIC_BASE ?? 'http://localhost:5173'
```

**Step 2: Add `remoteWs` field to ManagedSession**

Find the `ManagedSession` interface (search for `interface ManagedSession`) and add:

```typescript
remoteWs?: WebSocket
remoteRoomId?: string
remoteUrl?: string
```

**Step 3: Add `startRemoteControl` method to SessionManager**

Add this method near `shareToViewer`:

```typescript
async startRemoteControl(sessionId: string): Promise<ShareResult> {
  const managed = this.sessions.get(sessionId)
  if (!managed) return { success: false, error: 'Session not found' }
  if (managed.remoteWs) return { success: true, url: managed.remoteUrl }

  try {
    // 1. Create room on relay server
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (RELAY_SECRET) headers['x-relay-secret'] = RELAY_SECRET
    const res = await fetch(`${RELAY_HTTP_URL}/rooms`, { method: 'POST', headers })
    if (!res.ok) return { success: false, error: 'Failed to create relay room' }
    const { roomId } = await res.json() as { roomId: string }

    // 2. Connect as owner
    const wsHeaders: Record<string, string> = {}
    if (RELAY_SECRET) wsHeaders['x-relay-secret'] = RELAY_SECRET
    const ws = new WebSocket(
      `${RELAY_URL}/rooms/${roomId}/ws?role=owner`,
      { headers: wsHeaders }
    )

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = (e) => reject(new Error('WebSocket connection failed'))
      setTimeout(() => reject(new Error('WebSocket timeout')), 5000)
    })

    // 3. Handle incoming viewer commands (send message to agent)
    ws.onmessage = (event) => {
      try {
        const cmd = JSON.parse(event.data as string) as { type: string; content?: string }
        if (cmd.type === 'send_message' && cmd.content) {
          this.sendMessage(sessionId, cmd.content).catch(() => {})
        }
      } catch {}
    }

    ws.onclose = () => {
      managed.remoteWs = undefined
    }

    // 4. Persist
    const remoteUrl = `${RELAY_PUBLIC_BASE}/r/${roomId}`
    managed.remoteWs = ws as unknown as WebSocket
    managed.remoteRoomId = roomId
    managed.remoteUrl = remoteUrl
    await updateSessionMetadata(managed.workspace.rootPath, sessionId, {
      remoteRoomId: roomId,
      remoteUrl,
    })

    this.sendEvent({ type: 'remote_control_started', sessionId, remoteUrl }, managed.workspace.id)
    return { success: true, url: remoteUrl }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
```

**Step 4: Add `stopRemoteControl` method**

```typescript
async stopRemoteControl(sessionId: string): Promise<ShareResult> {
  const managed = this.sessions.get(sessionId)
  if (!managed) return { success: false, error: 'Session not found' }

  managed.remoteWs?.close()
  managed.remoteWs = undefined
  managed.remoteRoomId = undefined
  managed.remoteUrl = undefined

  await updateSessionMetadata(managed.workspace.rootPath, sessionId, {
    remoteRoomId: undefined,
    remoteUrl: undefined,
  })

  this.sendEvent({ type: 'remote_control_stopped', sessionId }, managed.workspace.id)
  return { success: true }
}
```

**Step 5: Forward SessionEvents to relay**

Find the `sendEvent` method and add relay forwarding at the end, before the closing brace:

```typescript
// Forward to remote control relay if active
const sessionId = (event as { sessionId?: string }).sessionId
if (sessionId) {
  const managed = this.sessions.get(sessionId)
  if (managed?.remoteWs?.readyState === WebSocket.OPEN) {
    managed.remoteWs.send(JSON.stringify(event))
  }
}
```

**Step 6: Wire up IPC in ipc.ts**

In `apps/electron/src/main/ipc.ts`, find the `SessionCommand` switch block and add alongside the share cases:

```typescript
case 'startRemoteControl':
  return sessionManager.startRemoteControl(sessionId)
case 'stopRemoteControl':
  return sessionManager.stopRemoteControl(sessionId)
```

**Step 7: Type-check**

```bash
cd apps/electron && bun run tsc --noEmit 2>&1 | head -30
```

**Step 8: Commit**

```bash
git add apps/electron/src/main/sessions.ts apps/electron/src/main/ipc.ts
git commit -m "feat: add startRemoteControl/stopRemoteControl to SessionManager"
```

---

## Task 5: Renderer — Remote Control toggle in SessionMenu

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/SessionMenu.tsx`

**Step 1: Add state and handlers**

In `SessionMenu.tsx`, find where `sharedUrl` is read from session state. Add alongside it:

```typescript
const remoteUrl = useSessionField(sessionId, 'remoteUrl')
```

Add handlers near `handleShare`:

```typescript
const handleStartRemoteControl = async () => {
  const result = await window.electronAPI.sessionCommand(sessionId, { type: 'startRemoteControl' })
  if (result?.success && result.url) {
    await navigator.clipboard.writeText(result.url)
    toast.success('Remote control link copied', {
      description: result.url,
      action: {
        label: 'Open',
        onClick: () => window.electronAPI.openUrl(result.url!),
      },
    })
  } else {
    toast.error('Failed to start remote control', { description: result?.error })
  }
}

const handleStopRemoteControl = async () => {
  const result = await window.electronAPI.sessionCommand(sessionId, { type: 'stopRemoteControl' })
  if (result?.success) {
    toast.success('Remote control stopped')
  } else {
    toast.error('Failed to stop remote control', { description: result?.error })
  }
}
```

**Step 2: Add menu items**

In the JSX, add a new section after the existing share menu items:

```tsx
{/* Remote Control */}
{!remoteUrl ? (
  <MenuItem onClick={handleStartRemoteControl}>
    <MonitorSmartphone className="h-3.5 w-3.5" />
    <span className="flex-1">Remote Control</span>
  </MenuItem>
) : (
  <Sub>
    <SubTrigger className="pr-2">
      <MonitorSmartphone className="h-3.5 w-3.5" />
      <span className="flex-1">Remote Control</span>
    </SubTrigger>
    <SubContent>
      <MenuItem onClick={() => window.electronAPI.openUrl(remoteUrl)}>
        <Globe className="h-3.5 w-3.5" />
        <span className="flex-1">Open in Browser</span>
      </MenuItem>
      <MenuItem onClick={() => navigator.clipboard.writeText(remoteUrl)}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">Copy Link</span>
      </MenuItem>
      <MenuItem onClick={handleStopRemoteControl} variant="destructive">
        <MonitorOff className="h-3.5 w-3.5" />
        <span className="flex-1">Stop Remote Control</span>
      </MenuItem>
    </SubContent>
  </Sub>
)}
```

Add `MonitorSmartphone` and `MonitorOff` to the lucide-react imports at the top.

**Step 3: Handle remote_control_started/stopped events**

Find where `session_shared` / `session_unshared` events are handled in the renderer (likely in a session event hook or atom). Add handling for the new event types to update `remoteUrl` in session state.

**Step 4: Type-check**

```bash
cd apps/electron && bun run tsc --noEmit 2>&1 | head -30
```

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/SessionMenu.tsx
git commit -m "feat: add Remote Control menu items to SessionMenu"
```

---

## Task 6: Viewer app — /r/:roomId route with live WebSocket

**Files:**
- Modify: `apps/viewer/src/App.tsx`
- Create: `apps/viewer/src/components/RemoteControlViewer.tsx`

**Step 1: Create RemoteControlViewer component**

```tsx
// apps/viewer/src/components/RemoteControlViewer.tsx
import { useEffect, useRef, useState } from 'react'
import type { StoredSession, Message } from '@work-agent/core'
import { SessionViewer } from '@work-agent/ui'

interface Props {
  roomId: string
  relayUrl: string
}

export function RemoteControlViewer({ roomId, relayUrl }: Props) {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const wsUrl = `${relayUrl}/rooms/${roomId}/ws?role=viewer`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (event) => {
      try {
        const sessionEvent = JSON.parse(event.data as string)
        applyEvent(sessionEvent)
      } catch {}
    }

    return () => ws.close()
  }, [roomId, relayUrl])

  function applyEvent(event: { type: string; [key: string]: unknown }) {
    setSession((prev) => {
      // Bootstrap: if we receive a full session snapshot
      if (event.type === 'session_snapshot') {
        return event.session as StoredSession
      }
      if (!prev) return prev

      // Append new messages
      if (event.type === 'user_message' || event.type === 'text_complete') {
        const msg = event.message as Message | undefined
        if (msg) {
          return { ...prev, messages: [...prev.messages, msg] }
        }
      }
      return prev
    })
  }

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'send_message', content: input.trim() }))
    setInput('')
  }

  const footer = (
    <div className="flex gap-2 p-3 border-t border-border">
      <input
        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder={connected ? 'Send a message...' : 'Connecting...'}
        value={input}
        disabled={!connected}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
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
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Connecting to remote session...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Waiting for session data...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
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
    </div>
  )
}
```

**Step 2: Add /r/:roomId routing to App.tsx**

In `apps/viewer/src/App.tsx`, add a new URL pattern check alongside the existing `/s/{id}` pattern:

```typescript
function getRemoteRoomIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/r\/([a-f0-9]+)$/)
  return match ? match[1] : null
}
```

In the main `App` component, add:

```typescript
const remoteRoomId = getRemoteRoomIdFromUrl()
const RELAY_WS_URL = import.meta.env.VITE_RELAY_WS_URL ?? 'ws://localhost:4747'

if (remoteRoomId) {
  return <RemoteControlViewer roomId={remoteRoomId} relayUrl={RELAY_WS_URL} />
}
```

Place this before the existing session rendering logic.

**Step 3: Add /r/* redirect in viewer's _redirects**

In `apps/viewer/public/_redirects`, add:

```
/r/*  /index.html  200
```

**Step 4: Add VITE_RELAY_WS_URL to viewer's vite.config.ts**

In the dev proxy config, add a proxy for the relay WebSocket:

```typescript
'/r-ws': {
  target: 'ws://localhost:4747',
  ws: true,
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/r-ws/, ''),
},
```

**Step 5: Type-check**

```bash
cd apps/viewer && bun run typecheck
```

**Step 6: Commit**

```bash
git add apps/viewer/src/components/RemoteControlViewer.tsx apps/viewer/src/App.tsx apps/viewer/public/_redirects
git commit -m "feat: add /r/:roomId remote control viewer route"
```

---

## Task 7: Session snapshot on connect

When a viewer connects to a room, they need the current session state (not just future events). The relay server already replays the event buffer, but we also need to send a full snapshot.

**Files:**
- Modify: `apps/electron/src/main/sessions.ts`

**Step 1: Send snapshot when owner connects**

In `startRemoteControl`, after the WebSocket `onopen` resolves, send the current session snapshot:

```typescript
// Send initial session snapshot so viewers who join get full state
const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId)
if (storedSession) {
  const snapshotEvent = JSON.stringify({ type: 'session_snapshot', session: storedSession })
  ws.send(snapshotEvent)
}
```

**Step 2: Also send snapshot when a new viewer joins**

The relay server's event buffer already handles this — the snapshot is the first buffered event. No additional change needed since the snapshot is sent immediately after owner connects and gets buffered.

**Step 3: Type-check and commit**

```bash
cd apps/electron && bun run tsc --noEmit 2>&1 | head -20
git add apps/electron/src/main/sessions.ts
git commit -m "feat: send session snapshot to relay on remote control start"
```

---

## Task 8: Environment config and relay server startup script

**Files:**
- Modify: `.env.example`
- Modify: `package.json` (root)

**Step 1: Add relay env vars to .env.example**

```bash
# Remote Control Relay Server
RELAY_URL=ws://localhost:4747
RELAY_HTTP_URL=http://localhost:4747
RELAY_SECRET=
RELAY_PUBLIC_BASE=http://localhost:5173
```

**Step 2: Add relay dev script to root package.json**

In the root `package.json` scripts, add:

```json
"relay:dev": "cd packages/relay-server && bun run src/index.ts"
```

**Step 3: Commit**

```bash
git add .env.example package.json
git commit -m "feat: add relay server env config and dev script"
```

---

## Testing the Full Flow

1. Start relay server: `bun run relay:dev`
2. Start Electron dev: `bun run electron:dev`
3. Start viewer dev: `bun run viewer:dev`
4. In Electron, open a session → Session Menu → "Remote Control"
5. A URL like `http://localhost:5173/r/<roomId>` is copied to clipboard
6. Open that URL in a browser
7. Verify: browser shows the session history
8. Type a message in the browser input → verify it appears in Electron and agent responds
9. Verify agent responses stream live to the browser
10. Click "Stop Remote Control" in Electron → verify browser shows disconnected state
