// Contracts for the huddle-voice PoC (wake-on-report voice front-end for a
// huddle orchestrator session). Module implementations code against these
// interfaces; the composition root (index.ts) wires them together.
//
// Audio format everywhere: PCM16 mono @ 24kHz, base64-encoded chunks
// (the Realtime API's native format — no resampling anywhere).

export const MODEL = 'gpt-realtime-2.1-mini'
export const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`
export const SAMPLE_RATE = 24000

export const VOICE_NAME = 'voice' // @mention that wakes the voice agent
export const ORCH_NAME = 'orch' // session name of the orchestrator Claude

// Sleep only after a comfortable stretch of USER SILENCE. Two windows: the
// normal one, and a longer grace right after activation so the agent doesn't
// nod off just as the user is gathering their thoughts. Adjust here only —
// these are the single source of truth for the daemon's idle policy.
export const IDLE_SILENCE_MS = 20_000 // user silence (with no pending work) → sleep
export const ACTIVATION_GRACE_MS = 45_000 // first window after wake, before the user has spoken
// ponytail: heuristic — lets a manual-sleep goodbye drain before we kill audio.
// A real player-drain signal would be exact; a fixed delay is enough for a one-liner.
export const GOODBYE_DRAIN_MS = 4_000 // grace for the goodbye to finish on a spoken "go to sleep"
export const DEBOUNCE_MS = 2_000 // batch reports arriving together into one wake
export const RECAP_LINES = 20 // huddle log lines seeded into each wake

// ---------------------------------------------------------------------------
// audio.ts — sox child-process wrappers

export interface MicHandle {
  stop(): void
}

export interface Player {
  /** Enqueue a base64 PCM16@24k chunk for playback. */
  play(b64pcm: string): void
  /** Barge-in: drop all queued/unplayed audio immediately. */
  flush(): void
  stop(): void
}

// audio.ts exports:
//   startMic(onChunk: (b64pcm: string) => void): MicHandle
//   createPlayer(): Player

// ---------------------------------------------------------------------------
// realtime.ts — one ephemeral gpt-realtime-2.1 WebSocket session

export interface RealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface VoiceSessionOpts {
  instructions: string
  tools: RealtimeTool[]
  /** Execute a model tool call; the resolved string is sent back as function_call_output. */
  onToolCall(name: string, args: unknown): Promise<string>
  /** User started talking (server VAD). Caller flushes the player for barge-in. */
  onSpeechStart(): void
  /** Model audio out — caller pipes to Player.play(). */
  onAudioChunk(b64pcm: string): void
  /** The model finished a response turn with no pending tool call. The daemon's
   *  idle controller uses this as the heartbeat to (re)start the silence
   *  countdown — it, not this session, owns the timer and the sleep decision. */
  onTurnComplete(): void
  onClose(err?: Error): void
}

export interface VoiceSession {
  /** Inject text as a user message and make the model speak a response. */
  injectAndSpeak(text: string): void
  /** Forward a mic chunk (→ input_audio_buffer.append). */
  sendMicChunk(b64pcm: string): void
  close(): void
}

// realtime.ts exports:
//   createVoiceSession(opts: VoiceSessionOpts): Promise<VoiceSession>

// ---------------------------------------------------------------------------
// wake.ts — pure state machine + daemon loop (deps injected; no direct
// imports of audio.ts/realtime.ts so it typechecks and tests standalone)

export type WakeEvent =
  | { t: 'report'; text: string; sender: string } // wake-worthy huddle message
  | { t: 'debounce_fired' }
  | { t: 'user_spoke' }
  | { t: 'session_idle' }
  | { t: 'session_closed' }

export type WakeAction =
  | { a: 'start_debounce' }
  | { a: 'spawn'; reports: string[] } // open session, speak these
  | { a: 'inject'; text: string } // session alive → add to conversation
  | { a: 'close_session' }
  | { a: 'notify'; text: string } // wake went unanswered → macOS notification

// wake.ts exports:
//   class WakeMachine { handle(ev: WakeEvent): WakeAction[] }
//   runWakeDaemon(deps: VoiceDeps): Promise<void>

export interface VoiceDeps {
  createVoiceSession(opts: VoiceSessionOpts): Promise<VoiceSession>
  startMic(onChunk: (b64pcm: string) => void): MicHandle
  createPlayer(): Player
  chime(): void
  notify(text: string): void
}

// ---------------------------------------------------------------------------
// The single tool exposed to the realtime model

export const SEND_TOOL: RealtimeTool = {
  type: 'function',
  name: 'send_to_orchestrator',
  description:
    'Relay a request or answer from the user to the orchestrator Claude session. ' +
    'Use for anything requiring real work: spawning/stopping coding sessions, status ' +
    'checks, log summaries. The reply arrives asynchronously — acknowledge out loud ' +
    'that you passed it on, and never invent results.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The message to send, phrased as a clear instruction or question.' },
    },
    required: ['text'],
  },
}

// Spoken "go to sleep" is handled as a model tool call, not raw transcript
// matching: the model only fires it when the user is clearly and directly
// addressing it, which keeps accidental triggers unlikely without any fuzzy
// phrase parsing on our side.
export const SLEEP_TOOL: RealtimeTool = {
  type: 'function',
  name: 'go_to_sleep',
  description:
    'Put yourself to sleep (stop listening) when the user clearly and directly tells you to — ' +
    'e.g. "go to sleep", "that\'s all", "we\'re done", "stand down". Only when the user is plainly ' +
    'addressing you and ending the session; never for a passing or hypothetical mention of sleep. ' +
    'Say a brief one-line goodbye first.',
  parameters: { type: 'object', properties: {}, required: [] },
}
