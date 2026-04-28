import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TRANSCRIPT_PATH } from '../shared/paths.ts'
import type { TranscriptRecord } from '../shared/protocol.ts'

let dirReady = false
function ensureDir(): void {
  if (dirReady) return
  mkdirSync(dirname(TRANSCRIPT_PATH), { recursive: true })
  dirReady = true
}

export function append(record: TranscriptRecord): void {
  ensureDir()
  appendFileSync(TRANSCRIPT_PATH, JSON.stringify(record) + '\n', 'utf8')
}

function readAll(): TranscriptRecord[] {
  if (!existsSync(TRANSCRIPT_PATH)) return []
  const raw = readFileSync(TRANSCRIPT_PATH, 'utf8')
  const out: TranscriptRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as TranscriptRecord)
    } catch {
      // skip corrupted line
    }
  }
  return out
}

export function tail(limit = 50): TranscriptRecord[] {
  const all = readAll()
  return all.slice(Math.max(0, all.length - limit))
}

export function since(iso: string, limit = 200): TranscriptRecord[] {
  const all = readAll()
  const filtered = all.filter(r => r.ts >= iso)
  return filtered.slice(0, limit)
}
