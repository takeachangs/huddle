import { openCli } from './client.ts'
import type { Message } from '../shared/protocol.ts'

export async function tail(args: string[]): Promise<void> {
  const showHistory = !args.includes('--no-history')
  const cli = await openCli()

  cli.on(frame => {
    if (frame.t === 'message') print(frame.msg)
    if (frame.t === 'log') for (const m of frame.messages) print(m)
  })

  if (showHistory) {
    cli.send({ t: 'read_log', limit: 20 })
  }
  cli.send({ t: 'subscribe_tail' })

  process.stderr.write('tuigether: tailing (Ctrl-C to stop)\n')
  await new Promise<void>(res => {
    process.on('SIGINT', () => { cli.close(); res() })
  })
}

function print(m: Message): void {
  const ts = m.ts.slice(11, 19)
  const tag = m.mentions.length ? `→${m.mentions.join(',')}` : ''
  const line = `[${ts}] ${m.sender}${tag ? ' ' + tag : ''}: ${m.text}\n`
  process.stdout.write(line)
}
