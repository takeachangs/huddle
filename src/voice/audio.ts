#!/usr/bin/env bun
// sox-based mic capture and playback. Format everywhere: raw PCM16, mono,
// 24000 Hz (SAMPLE_RATE), chunks base64-encoded at the boundary.

import { SAMPLE_RATE } from './types.ts'
import type { MicHandle, Player } from './types.ts'

const SOX_ARGS = ['-q', '-t', 'raw', '-r', String(SAMPLE_RATE), '-e', 'signed', '-b', '16', '-c', '1', '-']

function enoentError(err: unknown, bin: string): Error {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return new Error(`\`${bin}\` not found — install sox: \`brew install sox\``)
  return err instanceof Error ? err : new Error(String(err))
}

function spawnRec() {
  try {
    return Bun.spawn(['rec', ...SOX_ARGS], { stdout: 'pipe' })
  } catch (err) {
    throw enoentError(err, 'rec')
  }
}

function spawnPlay() {
  try {
    return Bun.spawn(['play', ...SOX_ARGS], { stdin: 'pipe', stdout: 'ignore' })
  } catch (err) {
    throw enoentError(err, 'play')
  }
}

export function startMic(onChunk: (b64pcm: string) => void): MicHandle {
  const proc = spawnRec()
  let stopped = false

  ;(async () => {
    for await (const chunk of proc.stdout) {
      if (chunk.length > 0) onChunk(Buffer.from(chunk).toString('base64'))
    }
  })().catch(() => {})

  return {
    stop() {
      if (stopped) return
      stopped = true
      proc.kill()
    },
  }
}

export function createPlayer(): Player {
  let proc: ReturnType<typeof spawnPlay> | null = spawnPlay()

  return {
    play(b64pcm: string) {
      if (!proc) proc = spawnPlay()
      try {
        proc.stdin.write(Buffer.from(b64pcm, 'base64'))
        proc.stdin.flush()
      } catch {
        // EPIPE / write-after-kill — swallow
      }
    },
    flush() {
      // Barge-in: drop whatever is queued by killing the process outright;
      // play() lazily respawns on next call.
      proc?.kill()
      proc = null
    },
    stop() {
      proc?.kill()
      proc = null
    },
  }
}

// ---------------------------------------------------------------------------
// Self-check: `bun src/voice/audio.ts --check`

if (import.meta.main) {
  const chunks: string[] = []
  let totalBytes = 0

  console.log('recording 2s of mic audio...')
  const mic = startMic((b64pcm) => {
    chunks.push(b64pcm)
    totalBytes += Buffer.from(b64pcm, 'base64').length
  })

  await new Promise((resolve) => setTimeout(resolve, 2000))
  mic.stop()

  console.log(`captured ${chunks.length} chunks, ${totalBytes} bytes`)
  if (totalBytes === 0) {
    throw new Error('mic captured no audio — check that sox `rec` can access the microphone')
  }

  console.log('playing back...')
  const player = createPlayer()
  for (const chunk of chunks) player.play(chunk)

  const playbackMs = (totalBytes / (SAMPLE_RATE * 2)) * 1000
  await new Promise((resolve) => setTimeout(resolve, playbackMs + 500))
  player.stop()

  console.log('audio check OK')
  process.exit(0)
}
