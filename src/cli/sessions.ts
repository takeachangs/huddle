import { openCli, requestReply } from './client.ts'

export async function sessions(): Promise<void> {
  const cli = await openCli()
  const reply = await requestReply(cli, { t: 'list_sessions' }, ['sessions'])
  if (reply.sessions.length === 0) {
    process.stdout.write('(no sessions connected)\n')
  } else {
    for (const s of reply.sessions) {
      process.stdout.write(`${s.name.padEnd(20)} pid=${s.pid} since ${s.connected_at}\n`)
    }
  }
  cli.close()
}
