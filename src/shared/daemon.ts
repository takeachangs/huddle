import { connect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { DAEMON_LOG_PATH, PID_PATH, SOCKET_PATH, STATE_DIR } from './paths.ts'
import { isProcessAlive } from './process.ts'

export async function tryConnect(retries = 20, delayMs = 100): Promise<Socket> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise<Socket>((res, rej) => {
        const sock = connect(SOCKET_PATH)
        sock.once('connect', () => res(sock))
        sock.once('error', err => rej(err))
      })
    } catch (err) {
      lastErr = err
      await sleep(delayMs)
    }
  }
  throw lastErr ?? new Error('failed to connect to coordinator')
}

export async function isDaemonAlive(): Promise<boolean> {
  try {
    const pid = Number(readFileSync(PID_PATH, 'utf8'))
    if (!pid || !isProcessAlive(pid)) return false
  } catch {
    return false
  }
  return new Promise(res => {
    const sock = connect(SOCKET_PATH)
    sock.once('connect', () => { sock.end(); res(true) })
    sock.once('error', () => res(false))
  })
}

export function spawnDaemon(): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const here = dirname(fileURLToPath(import.meta.url))
  const daemonScript = resolve(here, '..', 'coordinator', 'index.ts')
  const log = openSync(DAEMON_LOG_PATH, 'a')
  const child = spawn('bun', [daemonScript], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  })
  child.unref()
}

/**
 * Connect to the coordinator. If it's not running, spawn it and retry.
 * Caller is responsible for sending the initial `hello` frame.
 */
export async function connectToDaemon(): Promise<Socket> {
  if (!(await isDaemonAlive())) {
    spawnDaemon()
    await sleep(150)
  }
  return tryConnect()
}
