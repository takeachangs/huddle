import { spawn } from 'node:child_process'

export async function claude(args: string[]): Promise<void> {
  const flags = ['--dangerously-load-development-channels', 'server:tuigether', ...args]
  const child = spawn('claude', flags, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', code => process.exit(code ?? 0))
  child.on('error', err => {
    process.stderr.write(`tuigether: failed to launch claude: ${err.message}\n`)
    process.exit(127)
  })
}
