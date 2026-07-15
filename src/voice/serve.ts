// huddle-voice serve: tiny local web app for the voice console.
// Serves app.html, bridges the browser to the huddle coordinator over a
// WebSocket, and mints ephemeral OpenAI Realtime client secrets so the API
// key never reaches the page.

import type { ServerWebSocket } from 'bun'
import { openCli } from '../cli/client.ts'
import type { CliConnection } from '../cli/client.ts'
import { MODEL, RECAP_LINES } from './types.ts'

const SECRET_URL = 'https://api.openai.com/v1/realtime/client_secrets'

export function serveApp(port: number): void {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    process.stderr.write('huddle-voice: OPENAI_API_KEY is not set\n')
    process.exit(1)
  }

  const bridges = new Map<unknown, CliConnection>()

  const server = Bun.serve({
    port,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        return srv.upgrade(req) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      if (url.pathname === '/secret' && req.method === 'POST') {
        const res = await fetch(SECRET_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model: MODEL,
              audio: { output: { voice: 'marin' } },
            },
          }),
        })
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.pathname === '/') {
        return new Response(Bun.file(new URL('./app.html', import.meta.url).pathname), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('not found', { status: 404 })
    },
    websocket: {
      async open(ws: ServerWebSocket<undefined>) {
        try {
          const cli = await openCli()
          bridges.set(ws, cli)
          cli.on(frame => {
            if (frame.t === 'log') ws.send(JSON.stringify({ t: 'history', records: frame.messages }))
            if (frame.t === 'tail_event') ws.send(JSON.stringify({ t: 'record', record: frame.record }))
          })
          cli.send({ t: 'read_log', limit: RECAP_LINES })
          cli.send({ t: 'subscribe_tail' })
        } catch (err) {
          ws.send(JSON.stringify({ t: 'bridge_error', reason: String(err) }))
          ws.close()
        }
      },
      message(ws: ServerWebSocket<undefined>, raw: string | Buffer) {
        const cli = bridges.get(ws)
        if (!cli) return
        try {
          const msg = JSON.parse(String(raw)) as { t: string; text?: string; mentions?: string[] }
          if (msg.t === 'send' && msg.text) {
            cli.send({ t: 'send', text: msg.text, mentions: msg.mentions })
          }
        } catch {
          // ignore malformed frames from the page
        }
      },
      close(ws: ServerWebSocket<undefined>) {
        bridges.get(ws)?.close()
        bridges.delete(ws)
      },
    },
  })

  process.stderr.write(`huddle-voice: console at http://localhost:${server.port}\n`)
}
