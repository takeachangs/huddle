import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDaemonAlive, openCli, requestReply } from './client.ts'
import { PID_PATH } from '../shared/paths.ts'

export async function stop(): Promise<void> {
  if (!(await isDaemonAlive())) {
    process.stdout.write('tuigetherd is not running\n')
    return
  }
  const cli = await openCli({ autostart: false })
  await requestReply(cli, { t: 'shutdown' }, ['ack'], 3000)
  cli.close()
  for (let i = 0; i < 20; i++) {
    if (!(await isDaemonAlive())) {
      process.stdout.write('tuigetherd stopped\n')
      return
    }
    await sleep(100)
  }
  // Daemon ack'd but didn't exit; SIGTERM the recorded pid.
  try {
    const pid = Number(readFileSync(PID_PATH, 'utf8'))
    if (pid) process.kill(pid, 'SIGTERM')
  } catch {
    // pidfile already gone — nothing to do.
  }
  process.stdout.write('tuigetherd stopped (forced)\n')
}
