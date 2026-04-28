import type { Socket } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDaemonAlive, spawnDaemon, tryConnect } from '../shared/daemon.ts'
import { attachReader, writeFrame } from '../shared/ndjson.ts'
import type { ClientFrame, ServerFrame } from '../shared/protocol.ts'

export interface CliConnection {
  socket: Socket
  on: (handler: (frame: ServerFrame) => void) => void
  send: (frame: ClientFrame) => void
  close: () => void
}

export async function openCli(opts: { autostart?: boolean } = {}): Promise<CliConnection> {
  const { autostart = true } = opts
  if (autostart && !(await isDaemonAlive())) {
    spawnDaemon()
    await sleep(200)
  }
  const socket = await tryConnect()
  let handler: ((frame: ServerFrame) => void) | null = null
  attachReader<ServerFrame>(socket, frame => {
    handler?.(frame)
  })
  writeFrame(socket, { t: 'hello', role: 'cli' })
  return {
    socket,
    on: h => { handler = h },
    send: f => writeFrame(socket, f),
    close: () => {
      if (socket.destroyed) return
      writeFrame(socket, { t: 'bye' })
      socket.end()
    },
  }
}

/**
 * Send a request frame, await a single matching reply.
 * Resolves on the first frame whose `t` is in `expectedTypes`; rejects on
 * `error` frames or after `timeoutMs`. The connection is left open for the
 * caller to close (or to stream further frames).
 */
export async function requestReply<T extends ServerFrame['t']>(
  cli: CliConnection,
  request: ClientFrame,
  expectedTypes: readonly T[],
  timeoutMs = 5000,
): Promise<Extract<ServerFrame, { t: T }>> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`request "${request.t}" timed out`)), timeoutMs)
    cli.on(frame => {
      if ((expectedTypes as readonly string[]).includes(frame.t)) {
        clearTimeout(timer)
        res(frame as Extract<ServerFrame, { t: T }>)
      } else if (frame.t === 'error') {
        clearTimeout(timer)
        rej(new Error(frame.reason))
      }
    })
    cli.send(request)
  })
}

export { isDaemonAlive, spawnDaemon }
