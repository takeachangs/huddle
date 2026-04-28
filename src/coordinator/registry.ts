import type { Socket } from 'node:net'
import type { Message, SessionInfo } from '../shared/protocol.ts'
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
 * Fan out a message:
 *   - to every bridge except the originating one (so a session doesn't echo
 *     its own reply back into its own context)
 *   - to every CLI tail subscriber
 */
export function fanout(msg: Message, originBridgeSocket?: Socket): void {
  for (const entry of bridges.values()) {
    if (entry.socket === originBridgeSocket) continue
    writeFrame(entry.socket, { t: 'message', msg })
  }
  for (const socket of tailSubscribers) {
    writeFrame(socket, { t: 'message', msg })
  }
}
