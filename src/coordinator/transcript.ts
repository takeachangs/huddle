import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TRANSCRIPT_PATH } from '../shared/paths.ts'
import type { Message } from '../shared/protocol.ts'

let dirReady = false
function ensureDir(): void {
  if (dirReady) return
  mkdirSync(dirname(TRANSCRIPT_PATH), { recursive: true })
  dirReady = true
}

export function append(msg: Message): void {
  ensureDir()
  appendFileSync(TRANSCRIPT_PATH, JSON.stringify(msg) + '\n', 'utf8')
}

function readAll(): Message[] {
  if (!existsSync(TRANSCRIPT_PATH)) return []
  const raw = readFileSync(TRANSCRIPT_PATH, 'utf8')
  const out: Message[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as Message)
    } catch {
      // skip corrupted line
    }
  }
  return out
}

export function tail(limit = 50): Message[] {
  const all = readAll()
  return all.slice(Math.max(0, all.length - limit))
}

export function since(iso: string, limit = 200): Message[] {
  const all = readAll()
  const filtered = all.filter(m => m.ts >= iso)
  return filtered.slice(0, limit)
}
