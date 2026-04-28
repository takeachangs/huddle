import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'
import type { ClientFrame, Message } from '../shared/protocol.ts'
import { attachReader, writeFrame } from '../shared/ndjson.ts'
import { SOCKET_PATH } from '../shared/paths.ts'
import { ulid } from '../shared/ulid.ts'
import { MENTION_USER } from '../shared/constants.ts'
import { mergeMentions, normalizeMentions, parseMentions } from '../shared/mentions.ts'
import {
  registerBridge,
  unregisterSocket,
  subscribeTail,
  listSessions,
  fanout,
} from './registry.ts'
import { append, since, tail } from './transcript.ts'

interface Identity {
  role: 'bridge' | 'cli'
  /** 'user' for CLI connections, the session name for bridge connections. */
  name: string
}

export function start(onShutdown: () => void): Server {
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH) } catch {}
  }

  const server = createServer(socket => handleConnection(socket, onShutdown))
  server.listen(SOCKET_PATH)
  return server
}

function handleConnection(socket: Socket, onShutdown: () => void): void {
  let identity: Identity | null = null

  socket.on('close', () => unregisterSocket(socket))
  socket.on('error', () => unregisterSocket(socket))

  attachReader<ClientFrame>(socket, frame => {
    if (frame.t === 'hello') {
      if (frame.role === 'bridge') {
        identity = { role: 'bridge', name: frame.session }
        registerBridge(frame.session, frame.pid, socket)
        writeFrame(socket, { t: 'welcome', identity: frame.session })
      } else {
        identity = { role: 'cli', name: MENTION_USER }
        writeFrame(socket, { t: 'welcome', identity: MENTION_USER })
      }
      return
    }

    if (!identity) {
      writeFrame(socket, { t: 'error', reason: 'must hello first' })
      socket.end()
      return
    }

    switch (frame.t) {
      case 'send': {
        const inlineMentions = parseMentions(frame.text)
        const explicit = normalizeMentions(frame.mentions)
        const mentions = mergeMentions(inlineMentions, explicit)
        const msg: Message = {
          id: ulid(),
          ts: new Date().toISOString(),
          sender: identity.name,
          mentions,
          text: frame.text,
        }
        append(msg)
        // Excluding the bridge's own socket prevents Claude from receiving
        // its own reply back as a notification.
        fanout(msg, identity.role === 'bridge' ? socket : undefined)
        writeFrame(socket, { t: 'ack' })
        return
      }
      case 'subscribe_tail': {
        if (identity.role !== 'cli') {
          writeFrame(socket, { t: 'error', reason: 'only cli can subscribe' })
          return
        }
        subscribeTail(socket)
        writeFrame(socket, { t: 'ack' })
        return
      }
      case 'list_sessions': {
        writeFrame(socket, { t: 'sessions', sessions: listSessions() })
        return
      }
      case 'read_log': {
        const messages = frame.since ? since(frame.since, frame.limit) : tail(frame.limit)
        writeFrame(socket, { t: 'log', messages })
        return
      }
      case 'shutdown': {
        if (identity.role !== 'cli') {
          writeFrame(socket, { t: 'error', reason: 'only cli can shutdown' })
          return
        }
        writeFrame(socket, { t: 'ack' })
        socket.end()
        // Defer so the ack flushes before the daemon exits.
        setImmediate(onShutdown)
        return
      }
      case 'bye': {
        socket.end()
        return
      }
    }
  }, () => {
    writeFrame(socket, { t: 'error', reason: 'malformed frame' })
  })
}
