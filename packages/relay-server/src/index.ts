import { RoomManager } from './room-manager'

const PORT = parseInt(process.env.PORT ?? '4747')
const RELAY_SECRET = process.env.RELAY_SECRET ?? ''
const manager = new RoomManager()

if (!RELAY_SECRET) {
  console.warn('Warning: RELAY_SECRET is not set. Relay server is open to anyone.')
}

interface WsData {
  roomId: string
  role: 'owner' | 'viewer'
}

// Prune stale rooms every hour
setInterval(() => manager.pruneStale(), 60 * 60 * 1000)

const server = Bun.serve<WsData>({
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
    const wsMatch = url.pathname.match(/^\/rooms\/([a-f0-9]{16})\/ws$/)
    if (wsMatch) {
      const roomId = wsMatch[1] as string
      const role: 'owner' | 'viewer' =
        url.searchParams.get('role') === 'owner' ? 'owner' : 'viewer'

      if (role === 'owner' && RELAY_SECRET) {
        if (req.headers.get('x-relay-secret') !== RELAY_SECRET) {
          return new Response('Unauthorized', { status: 401 })
        }
      }

      const room = manager.getRoom(roomId)
      if (!room) return new Response('Room not found', { status: 404 })

      // Reject duplicate owner connections before upgrading
      if (role === 'owner' && [...room.clients].some(c => c.role === 'owner')) {
        return new Response('owner_already_connected', { status: 409 })
      }

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
      const { roomId, role } = ws.data
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
      const { roomId, role } = ws.data
      const room = manager.getRoom(roomId)
      if (!room) return

      const raw = typeof message === 'string' ? message : message.toString()

      // Reject oversized messages (10MB to support file attachments)
      if (raw.length > 10_000_000) return

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
      const { roomId } = ws.data
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
