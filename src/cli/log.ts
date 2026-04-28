import { openCli, requestReply } from './client.ts'
import { renderRecord } from './render.ts'

export async function log(args: string[]): Promise<void> {
  let since: string | undefined
  let limit = 50
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--since') {
      since = args[++i]
      if (!since) throw new Error('--since requires a value')
    } else if (a === '--n' || a === '-n') {
      const v = args[++i]
      if (!v) throw new Error('--n requires a value')
      limit = Number(v)
      if (!Number.isFinite(limit) || limit <= 0) throw new Error('--n must be positive')
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(`Usage: huddle log [--since ISO_TS] [--n LIMIT]\n`)
      return
    }
  }
  const cli = await openCli()
  const reply = await requestReply(cli, { t: 'read_log', since, limit }, ['log'])
  for (const r of reply.messages) {
    process.stdout.write(renderRecord(r, { time: 'iso' }) + '\n')
  }
  cli.close()
}
