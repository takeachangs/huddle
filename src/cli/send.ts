import { openCli, requestReply } from './client.ts'

export async function send(args: string[]): Promise<void> {
  const mentions: string[] = []
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--to' || a === '-t') {
      const next = args[++i]
      if (!next) throw new Error('--to requires a value')
      mentions.push(next)
    } else if (a === '--help' || a === '-h') {
      printHelp()
      return
    } else {
      positional.push(a)
    }
  }
  const text = positional.join(' ').trim()
  if (!text) {
    printHelp()
    process.exit(2)
  }

  const cli = await openCli()
  await requestReply(cli, {
    t: 'send',
    text,
    mentions: mentions.length ? mentions : undefined,
  }, ['ack'])
  cli.close()
}

function printHelp(): void {
  process.stderr.write(`Usage: tuigether send [--to NAME] [--to NAME] ... "your message"\n` +
    `  Inline @mentions in the message body are also parsed.\n`)
}
