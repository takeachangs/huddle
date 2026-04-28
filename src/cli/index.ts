#!/usr/bin/env bun
import { send } from './send.ts'
import { tail } from './tail.ts'
import { sessions } from './sessions.ts'
import { log } from './log.ts'
import { start } from './start.ts'
import { stop } from './stop.ts'
import { init } from './init.ts'
import { claude } from './claude.ts'

const [cmd, ...rest] = process.argv.slice(2)

async function main(): Promise<void> {
  switch (cmd) {
    case 'init':     return init(rest)
    case 'claude':   return claude(rest)
    case 'send':     return send(rest)
    case 'tail':     return tail(rest)
    case 'sessions': return sessions()
    case 'log':      return log(rest)
    case 'start':    return start()
    case 'stop':     return stop()
    case undefined:
    case 'help':
    case '--help':
    case '-h':       return printHelp()
    default:
      process.stderr.write(`huddle: unknown command "${cmd}"\n\n`)
      printHelp()
      process.exit(2)
  }
}

function printHelp(): void {
  process.stdout.write(`huddle — multi-session Claude Code group chat

Usage:
  huddle init [--name SESSION]         wire current dir up to huddle (writes .mcp.json)
  huddle claude [...claude args]       launch claude with the channel flag
  huddle send [--to NAME] "message"    send a message (inline @mentions also parsed)
  huddle tail                          stream the live transcript (Ctrl-C to stop)
  huddle sessions                      list connected Claude sessions
  huddle log [--since ISO] [--n N]     read transcript history
  huddle start                         start the coordinator daemon
  huddle stop                          stop the coordinator daemon
  huddle help                          this message
`)
}

main().catch(err => {
  process.stderr.write(`huddle: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
