import type { Socket } from 'node:net'
import { attachReader, writeFrame } from '../shared/ndjson.ts'
import { connectToDaemon } from '../shared/daemon.ts'
import type { ClientFrame, Message, ServerFrame } from '../shared/protocol.ts'

interface ConnectOpts {
  session: string
  pid: number
  onMessage: (msg: Message) => void
  onDisconnect: () => void
}

export class CoordinatorClient {
  private socket: Socket | null = null
  private opts: ConnectOpts

  constructor(opts: ConnectOpts) {
    this.opts = opts
  }

  async connect(): Promise<void> {
    const socket = await connectToDaemon()
    this.socket = socket

    attachReader<ServerFrame>(socket, frame => {
      if (frame.t === 'message') this.opts.onMessage(frame.msg)
    })

    socket.on('close', () => this.opts.onDisconnect())

    writeFrame(socket, {
      t: 'hello',
      role: 'bridge',
      session: this.opts.session,
      pid: this.opts.pid,
    } satisfies ClientFrame)
  }

  send(text: string, mentions?: string[]): void {
    if (!this.socket || this.socket.destroyed) return
    writeFrame(this.socket, { t: 'send', text, mentions } satisfies ClientFrame)
  }

  close(): void {
    if (!this.socket || this.socket.destroyed) return
    writeFrame(this.socket, { t: 'bye' } satisfies ClientFrame)
    this.socket.end()
  }
}
