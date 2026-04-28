import { MENTION_ALL, MENTION_USER } from './constants.ts'

const MENTION_RE = /(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g

export function parseMentions(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(MENTION_RE)) {
    const name = match[1]
    if (name) seen.add(name.toLowerCase())
  }
  return [...seen]
}

export function normalizeMentions(mentions: string[] | undefined): string[] {
  if (!mentions) return []
  const seen = new Set<string>()
  for (const m of mentions) {
    const stripped = m.startsWith('@') ? m.slice(1) : m
    if (stripped) seen.add(stripped.toLowerCase())
  }
  return [...seen]
}

export function mergeMentions(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}

export function isAddressed(args: {
  ownName: string
  sender: string
  mentions: string[]
}): boolean {
  const { ownName, sender, mentions } = args
  const own = ownName.toLowerCase()
  if (mentions.includes(MENTION_ALL)) return true
  if (mentions.includes(own)) return true
  if (mentions.length === 0 && sender === MENTION_USER) return true
  return false
}
