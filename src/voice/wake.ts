// Wake-on-report state machine + daemon loop. WakeMachine is pure (no I/O,
// no timers) — runWakeDaemon owns the real timers/sockets/audio and drives
// the machine off them.

import { deepStrictEqual } from 'node:assert'
import { openCli } from '../cli/client.ts'
import { MENTION_USER } from '../shared/constants.ts'
import type { ServerFrame } from '../shared/protocol.ts'
import {
  ACTIVATION_GRACE_MS,
  DEBOUNCE_MS,
  GOODBYE_DRAIN_MS,
  IDLE_SILENCE_MS,
  ORCH_NAME,
  RECAP_LINES,
  SEND_TOOL,
  SLEEP_TOOL,
  VOICE_NAME,
} from './types.ts'
import type { MicHandle, Player, VoiceDeps, VoiceSession, WakeAction, WakeEvent } from './types.ts'

export class WakeMachine {
  private state: 'asleep' | 'waking' | 'alive' = 'asleep'
  private buffer: string[] = []
  private spawnReports: string[] = []
  private engaged = false

  handle(ev: WakeEvent): WakeAction[] {
    switch (this.state) {
      case 'asleep':
        if (ev.t === 'report') {
          this.buffer.push(ev.text)
          this.state = 'waking'
          return [{ a: 'start_debounce' }]
        }
        return []

      case 'waking':
        if (ev.t === 'report') {
          this.buffer.push(ev.text)
          return []
        }
        if (ev.t === 'debounce_fired') {
          const reports = this.buffer
          this.buffer = []
          this.spawnReports = reports
          this.engaged = false
          this.state = 'alive'
          return [{ a: 'spawn', reports }]
        }
        return []

      case 'alive':
        if (ev.t === 'report') return [{ a: 'inject', text: ev.text }]
        if (ev.t === 'user_spoke') {
          this.engaged = true
          return []
        }
        if (ev.t === 'session_idle') return [{ a: 'close_session' }]
        if (ev.t === 'session_closed') return this.onSessionClosed()
        return []
    }
  }

  private onSessionClosed(): WakeAction[] {
    this.state = 'asleep'
    if (this.engaged) return []
    const first = this.spawnReports[0] ?? ''
    return [{ a: 'notify', text: first.slice(0, 200) }]
  }
}

export async function runWakeDaemon(deps: VoiceDeps): Promise<void> {
  const cli = await openCli()
  const machine = new WakeMachine()

  let session: VoiceSession | null = null
  let mic: MicHandle | null = null
  let player: Player | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingLog: ((frame: Extract<ServerFrame, { t: 'log' }>) => void) | null = null
  let pendingInjects: string[] = []

  // ── Idle policy ────────────────────────────────────────────────────────────
  // The ONE place that decides "should we sleep now?". Sleep fires only after a
  // stretch of USER SILENCE — ACTIVATION_GRACE_MS for the first window (before
  // the user has spoken, so we don't cut them off just as they're about to talk)
  // then IDLE_SILENCE_MS — and NEVER while a request is outstanding (waiting on
  // @orch or a tool call): that countdown is held, not ticking, and the next
  // completed turn re-arms it once the wait clears. A spoken "go to sleep"
  // (sleepRequested) bypasses the window and sleeps right after the goodbye turn.
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let waiting = false // outstanding @orch request → hold the countdown
  let everSpoke = false // user has spoken at least once this session
  let sleepRequested = false // user asked to sleep → sleep after the goodbye turn

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }
  function armIdle(): void {
    clearIdle()
    const window = everSpoke ? IDLE_SILENCE_MS : ACTIVATION_GRACE_MS
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (waiting) return // held — a later completed turn re-arms once the wait clears
      dispatch({ t: 'session_idle' })
    }, window)
  }
  function resetIdle(): void {
    clearIdle()
    waiting = false
    everSpoke = false
    sleepRequested = false
  }

  function stopAudio(): void {
    mic?.stop()
    player?.stop()
    mic = null
    player = null
    session = null
    pendingInjects = []
    resetIdle()
  }

  function dispatch(ev: WakeEvent): void {
    const actions = machine.handle(ev)
    if (ev.t === 'session_closed') stopAudio()
    for (const action of actions) {
      void runAction(action)
    }
  }

  async function runAction(action: WakeAction): Promise<void> {
    switch (action.a) {
      case 'start_debounce': {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          dispatch({ t: 'debounce_fired' })
        }, DEBOUNCE_MS)
        return
      }

      case 'spawn': {
        deps.chime()
        const recap = await new Promise<Extract<ServerFrame, { t: 'log' }>>(resolve => {
          pendingLog = resolve
          cli.send({ t: 'read_log', limit: RECAP_LINES })
        })
        pendingLog = null
        const recapLines = recap.messages
          .filter(m => m.kind === 'msg')
          .map(m => `${m.sender}: ${m.text}`)

        const instructions = [
          "You are the user's terse voice liaison to their Claude Code orchestrator. " +
            'Speak briefly. Use the send_to_orchestrator tool for anything needing real ' +
            'work. Never fabricate results. When the user clearly tells you to go to ' +
            'sleep or that they are done, call go_to_sleep after a brief goodbye.',
          'Recent channel history:',
          ...recapLines,
          'New report(s) to relay to the user now:',
          ...action.reports,
        ].join('\n')

        resetIdle()
        player = deps.createPlayer()
        session = await deps.createVoiceSession({
          instructions,
          tools: [SEND_TOOL, SLEEP_TOOL],
          onToolCall: async (name, args) => {
            if (name === 'go_to_sleep') {
              // Manual sleep: acknowledge and sleep on the next completed turn —
              // we don't cut a reply off mid-sentence, but we also don't wait out
              // the silence window. If an @orch request was still outstanding, its
              // reply just re-wakes us later, so sleeping now loses nothing.
              sleepRequested = true
              return 'Acknowledged — give the user a brief one-line goodbye, then stop.'
            }
            if (name !== 'send_to_orchestrator') return `unknown tool: ${name}`
            const { text } = args as { text: string }
            cli.send({ t: 'send', text, mentions: [ORCH_NAME] })
            waiting = true // hold the idle countdown until the reply lands
            return 'sent — the reply will arrive asynchronously.'
          },
          onAudioChunk: b64pcm => player?.play(b64pcm),
          onSpeechStart: () => {
            player?.flush()
            everSpoke = true
            sleepRequested = false // barge-in after "go to sleep" = changed mind, stay awake
            clearIdle() // never sleep while speech is starting/in progress
            dispatch({ t: 'user_spoke' })
          },
          onTurnComplete: () => {
            if (sleepRequested) {
              // Let the goodbye finish playing, then sleep — prompt vs the full
              // silence window, but the user still hears the acknowledgment.
              clearIdle()
              idleTimer = setTimeout(() => {
                idleTimer = null
                dispatch({ t: 'session_idle' })
              }, GOODBYE_DRAIN_MS)
            } else armIdle()
          },
          onClose: () => dispatch({ t: 'session_closed' }),
        })
        mic = deps.startMic(chunk => session?.sendMicChunk(chunk))
        session.injectAndSpeak('Deliver the new report(s) to the user now, in one or two sentences.')
        for (const text of pendingInjects) session.injectAndSpeak(text)
        pendingInjects = []
        return
      }

      case 'inject':
        waiting = false // a reply / new info landed → release the held countdown
        // ponytail: reports racing the async spawn are queued, not dropped
        if (session) session.injectAndSpeak(action.text)
        else pendingInjects.push(action.text)
        return

      case 'close_session':
        session?.close()
        stopAudio()
        return

      case 'notify':
        deps.notify(action.text)
        return
    }
  }

  cli.on(frame => {
    if (frame.t === 'log') {
      pendingLog?.(frame)
      return
    }
    if (frame.t !== 'tail_event') return
    const record = frame.record
    if (record.kind === 'msg' && record.mentions.includes(VOICE_NAME) && record.sender !== MENTION_USER) {
      dispatch({ t: 'report', text: `${record.sender}: ${record.text}`, sender: record.sender })
    }
  })

  cli.send({ t: 'subscribe_tail' })

  await new Promise<void>(() => {})
}

if (import.meta.main) {
  const m1 = new WakeMachine()
  deepStrictEqual(m1.handle({ t: 'report', text: 'alpha: did the thing', sender: 'alpha' }), [{ a: 'start_debounce' }])
  deepStrictEqual(m1.handle({ t: 'report', text: 'beta: also did a thing', sender: 'beta' }), [])
  deepStrictEqual(m1.handle({ t: 'debounce_fired' }), [
    { a: 'spawn', reports: ['alpha: did the thing', 'beta: also did a thing'] },
  ])
  deepStrictEqual(m1.handle({ t: 'report', text: 'gamma: update', sender: 'gamma' }), [
    { a: 'inject', text: 'gamma: update' },
  ])
  deepStrictEqual(m1.handle({ t: 'session_idle' }), [{ a: 'close_session' }])
  deepStrictEqual(m1.handle({ t: 'session_closed' }), [{ a: 'notify', text: 'alpha: did the thing' }])

  const m2 = new WakeMachine()
  m2.handle({ t: 'report', text: 'alpha: hi', sender: 'alpha' })
  m2.handle({ t: 'debounce_fired' })
  deepStrictEqual(m2.handle({ t: 'user_spoke' }), [])
  deepStrictEqual(m2.handle({ t: 'session_idle' }), [{ a: 'close_session' }])
  deepStrictEqual(m2.handle({ t: 'session_closed' }), [])

  const m3 = new WakeMachine()
  deepStrictEqual(m3.handle({ t: 'session_idle' }), [])

  console.log('wake check OK')
}
