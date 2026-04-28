import { openCli } from './client.ts'
import type { TranscriptRecord } from '../shared/protocol.ts'
import { renderRecord } from './render.ts'

export async function tail(args: string[]): Promise<void> {
  const showHistory = !args.includes('--no-history')
  const cli = await openCli()

  cli.on(frame => {
    if (frame.t === 'tail_event') print(frame.record)
    if (frame.t === 'log') for (const r of frame.messages) print(r)
  })

  if (showHistory) {
    cli.send({ t: 'read_log', limit: 20 })
  }
  cli.send({ t: 'subscribe_tail' })

  process.stderr.write('huddle: tailing (Ctrl-C to stop)\n')
  await new Promise<void>(res => {
    process.on('SIGINT', () => { cli.close(); res() })
  })
}

function print(r: TranscriptRecord): void {
  process.stdout.write(renderRecord(r, { time: 'short' }) + '\n')
}
