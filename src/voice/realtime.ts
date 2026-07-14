// WebSocket client for OpenAI's gpt-realtime-2.1 speech-to-speech model.
// Wire protocol: current GA Realtime API — session.update with a nested
// session.type: 'realtime' and audio.input/audio.output format objects,
// response.output_audio.delta for model audio out. NOT the older beta shapes
// (no top-level voice/input_audio_format, no response.audio.delta).

import { IDLE_MS, REALTIME_URL } from './types.ts'
import type { RealtimeTool, VoiceSession, VoiceSessionOpts } from './types.ts'

function sessionUpdate(instructions: string, tools: RealtimeTool[]) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions,
      output_modalities: ['audio'],
      tools,
      tool_choice: 'auto',
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: { type: 'server_vad' } },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' },
      },
    },
  }
}

export async function createVoiceSession(opts: VoiceSessionOpts): Promise<VoiceSession> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const ws = new WebSocket(REALTIME_URL, { headers: { Authorization: `Bearer ${apiKey}` } })

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }
  function armIdle(): void {
    clearIdle()
    idleTimer = setTimeout(() => opts.onIdle(), IDLE_MS)
  }
  function send(obj: unknown): void {
    ws.send(JSON.stringify(obj))
  }
  function finish(err?: Error): void {
    if (closed) return
    closed = true
    clearIdle()
    opts.onClose(err)
  }

  async function handleToolCall(call: { name: string; call_id: string; arguments: string }): Promise<void> {
    const args = JSON.parse(call.arguments)
    const result = await opts.onToolCall(call.name, args)
    const output = result.length > 8000 ? result.slice(0, 8000) : result
    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: call.call_id, output },
    })
    send({ type: 'response.create' })
  }

  ws.addEventListener('message', ev => {
    let msg: any
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    switch (msg.type) {
      case 'response.output_audio.delta':
        opts.onAudioChunk(msg.delta)
        break
      case 'input_audio_buffer.speech_started':
        clearIdle()
        send({ type: 'response.cancel' })
        opts.onSpeechStart()
        break
      case 'response.done': {
        clearIdle()
        const output: any[] = msg.response?.output ?? []
        const calls = output.filter((item: any) => item?.type === 'function_call')
        if (calls.length === 0) {
          armIdle()
        } else {
          for (const call of calls) void handleToolCall(call)
        }
        break
      }
      case 'error':
        process.stderr.write(`realtime: ${JSON.stringify(msg)}\n`)
        break
      default:
        break
    }
  })

  ws.addEventListener('close', () => finish())
  ws.addEventListener('error', () => finish(new Error('realtime websocket error')))

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => {
      send(sessionUpdate(opts.instructions, opts.tools))
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => reject(new Error('realtime: failed to connect')), { once: true })
  })

  return {
    injectAndSpeak(text: string): void {
      clearIdle()
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
      send({ type: 'response.create' })
    },
    sendMicChunk(b64pcm: string): void {
      send({ type: 'input_audio_buffer.append', audio: b64pcm })
    },
    close(): void {
      if (closed) return
      closed = true
      clearIdle()
      ws.close()
      opts.onClose()
    },
  }
}

// ---------------------------------------------------------------------------
// Self-check: `bun src/voice/realtime.ts --check`

if (import.meta.main) {
  let totalBytes = 0
  let resolveAudio: (() => void) | undefined
  const gotAudio = new Promise<void>(resolve => {
    resolveAudio = resolve
  })

  const session = await createVoiceSession({
    instructions: 'You are a test. Comply exactly.',
    tools: [],
    onToolCall: async () => '',
    onSpeechStart: () => {},
    onAudioChunk: (b64pcm: string) => {
      totalBytes += Buffer.from(b64pcm, 'base64').length
      resolveAudio?.()
    },
    onIdle: () => {},
    onClose: () => {},
  })

  session.injectAndSpeak('Say the single word hello.')

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('timed out waiting for output_audio delta')), 15_000)
  })

  try {
    await Promise.race([gotAudio, timeout])
    console.log(`received ${totalBytes} bytes of audio`)
    console.log('realtime check OK')
    session.close()
    process.exit(0)
  } catch (err) {
    console.error(String(err))
    session.close()
    process.exit(1)
  }
}
