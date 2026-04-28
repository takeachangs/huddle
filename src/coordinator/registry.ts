import type { Socket } from 'node:net'
import type { Message, SessionInfo, TranscriptRecord } from '../shared/protocol.ts'
import { writeFrame } from '../shared/ndjson.ts'

interface BridgeEntry {
  name: string
  pid: number
  connected_at: string
  socket: Socket
}

const bridges = new Map<string, BridgeEntry>()
const tailSubscribers = new Set<Socket>()

export function registerBridge(name: string, pid: number, socket: Socket): void {
  const previous = bridges.get(name)
  if (previous && previous.socket !== socket) {
    writeFrame(previous.socket, { t: 'error', reason: `superseded by new ${name} session (pid ${pid})` })
    previous.socket.end()
  }
  bridges.set(name, {
    name,
    pid,
    connected_at: new Date().toISOString(),
    socket,
  })
}

export function unregisterSocket(socket: Socket): void {
  tailSubscribers.delete(socket)
  for (const [name, entry] of bridges) {
    if (entry.socket === socket) bridges.delete(name)
  }
}

export function subscribeTail(socket: Socket): void {
  tailSubscribers.add(socket)
}

export function listSessions(): SessionInfo[] {
  return [...bridges.values()].map(b => ({
    name: b.name,
    pid: b.pid,
    connected_at: b.connected_at,
  }))
}

/**
 * Notify other Claude sessions of a new chat message.
 *   - Bridges: every one except the originator (sessions don't echo their own
 *     replies back into their own context).
 *   - Tail subscribers: every CLI watching `huddle tail` (including any
 *     that originated the message — they want to see it rendered).
 */
export function fanoutMessage(msg: Message, originBridgeSocket?: Socket): void {
  for (const entry of bridges.values()) {
    if (entry.socket === originBridgeSocket) continue
    writeFrame(entry.socket, { t: 'message', msg })
  }
  for (const socket of tailSubscribers) {
    writeFrame(socket, { t: 'tail_event', record: msg })
  }
}

/**
 * Reactions and passes are NOT pushed to other Claude sessions (zero noise
 * budget). Only the CLI tail sees them so the user has live audit visibility.
 */
export function fanoutAuditOnly(record: TranscriptRecord): void {
  for (const socket of tailSubscribers) {
    writeFrame(socket, { t: 'tail_event', record })
  }
}
