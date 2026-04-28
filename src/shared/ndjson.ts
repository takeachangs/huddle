import type { Socket } from 'node:net'

export type FrameHandler<T> = (frame: T) => void | Promise<void>

export function attachReader<T>(socket: Socket, onFrame: FrameHandler<T>, onError?: (e: unknown) => void): void {
  let buf = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buf += chunk
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      try {
        const frame = JSON.parse(line) as T
        void onFrame(frame)
      } catch (err) {
        onError?.(err)
      }
    }
  })
}

export function writeFrame(socket: Socket, frame: unknown): void {
  if (socket.destroyed || !socket.writable) return
  socket.write(JSON.stringify(frame) + '\n')
}
