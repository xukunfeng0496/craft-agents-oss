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

const MAX_BUFFER = 5000
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
    // If this is a permission_cleared event, remove the matching permission_request from buffer
    // so reconnecting viewers don't see stale permission dialogs
    try {
      const parsed = JSON.parse(message) as { type?: string; requestId?: string }
      if (parsed.type === 'permission_cleared' && parsed.requestId) {
        const reqId = parsed.requestId
        room.eventBuffer = room.eventBuffer.filter(e => {
          try {
            const ev = JSON.parse(e) as { type?: string; request?: { requestId?: string } }
            return !(ev.type === 'permission_request' && ev.request?.requestId === reqId)
          } catch { return true }
        })
      }
    } catch { /* not JSON, ignore */ }

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
