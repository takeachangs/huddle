import { spawn } from 'node:child_process'

export async function claude(args: string[]): Promise<void> {
  // `--voice` co-launches the voice web console alongside this session. Bun.serve
  // is non-blocking, so we start it in-process and let `process.exit` on claude's
  // exit tear it down — `huddle claude --voice` brings both up and down together.
  const withVoice = args.includes('--voice')
  const claudeArgs = args.filter(a => a !== '--voice')

  if (withVoice) {
    if (!process.env.OPENAI_API_KEY) {
      process.stderr.write('huddle: --voice needs OPENAI_API_KEY; launching claude without the voice console\n')
    } else {
      try {
        const { serveApp } = await import('../voice/serve.ts')
        serveApp(4425)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`huddle: voice console did not start (${msg}); continuing with claude\n`)
      }
    }
  }

  const flags = ['--dangerously-load-development-channels', 'server:huddle', ...claudeArgs]
  const child = spawn('claude', flags, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', code => process.exit(code ?? 0))
  child.on('error', err => {
    process.stderr.write(`huddle: failed to launch claude: ${err.message}\n`)
    process.exit(127)
  })
}
