import { isDaemonAlive, spawnDaemon } from './client.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { SOCKET_PATH } from '../shared/paths.ts'

export async function start(): Promise<void> {
  if (await isDaemonAlive()) {
    process.stdout.write(`huddled already running (${SOCKET_PATH})\n`)
    return
  }
  spawnDaemon()
  for (let i = 0; i < 30; i++) {
    await sleep(100)
    if (await isDaemonAlive()) {
      process.stdout.write(`huddled started (${SOCKET_PATH})\n`)
      return
    }
  }
  process.stderr.write('huddle: daemon did not become ready in 3s; check coordinator log\n')
  process.exit(1)
}
