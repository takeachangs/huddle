#!/usr/bin/env bun
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { PID_PATH, SOCKET_PATH, STATE_DIR } from '../shared/paths.ts'
import { isProcessAlive } from '../shared/process.ts'
import { start } from './server.ts'

mkdirSync(STATE_DIR, { recursive: true })

try {
  const existing = Number(readFileSync(PID_PATH, 'utf8'))
  if (existing && isProcessAlive(existing)) {
    process.stderr.write(`huddled already running (pid ${existing})\n`)
    process.exit(0)
  }
  unlinkSync(PID_PATH)
} catch {
  // No (or stale) pidfile — proceed.
}

writeFileSync(PID_PATH, String(process.pid), 'utf8')

const server = start(shutdown)

server.on('listening', () => {
  process.stderr.write(`huddled listening on ${SOCKET_PATH} (pid ${process.pid})\n`)
})

server.on('error', err => {
  process.stderr.write(`huddled: ${err}\n`)
  cleanup()
  process.exit(1)
})

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('huddled: shutting down\n')
  server.close(() => {
    cleanup()
    process.exit(0)
  })
  // Force exit if close hangs on lingering sockets.
  setTimeout(() => {
    cleanup()
    process.exit(0)
  }, 2000).unref()
}

function cleanup(): void {
  try { unlinkSync(SOCKET_PATH) } catch {}
  try { unlinkSync(PID_PATH) } catch {}
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
