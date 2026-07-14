#!/usr/bin/env bun
// huddle-voice: wake-on-report voice daemon. Subscribes to the huddle
// coordinator; an @voice mention from any Claude session wakes an ephemeral
// gpt-realtime-2.1 session that speaks the report and listens for a reply.

import { startMic, createPlayer } from './audio.ts'
import { createVoiceSession } from './realtime.ts'
import { runWakeDaemon } from './wake.ts'
import type { VoiceDeps, VoiceSessionOpts } from './types.ts'

function log(line: string): void {
  process.stderr.write(`huddle-voice: ${line}\n`)
}

function fireAndForget(cmd: string[]): void {
  try {
    Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    // chime/notify are best-effort
  }
}

const deps: VoiceDeps = {
  startMic,
  createPlayer,
  createVoiceSession: async (opts: VoiceSessionOpts) => {
    log('waking: opening realtime session')
    const session = await createVoiceSession({
      ...opts,
      onIdle: () => {
        log('idle: no reply, going back to sleep')
        opts.onIdle()
      },
      onClose: err => {
        log(err ? `session closed with error: ${err.message}` : 'session closed')
        opts.onClose(err)
      },
    })
    log('awake: listening')
    return session
  },
  chime: () => fireAndForget(['afplay', '/System/Library/Sounds/Glass.aiff']),
  notify: text => {
    log(`notify: ${text}`)
    fireAndForget([
      'osascript', '-e',
      `display notification ${JSON.stringify(text)} with title "huddle voice"`,
    ])
  },
}

if (process.argv[2] === 'serve') {
  const portFlag = process.argv.indexOf('--port')
  const port = portFlag !== -1 ? Number(process.argv[portFlag + 1]) : 4425
  const { serveApp } = await import('./serve.ts')
  serveApp(port)
} else {
  log('daemon up — waiting for @voice reports (Ctrl-C to stop)')
  await runWakeDaemon(deps)
}
