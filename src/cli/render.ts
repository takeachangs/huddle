import type { TranscriptRecord } from '../shared/protocol.ts'

interface RenderOpts {
  /** 'short' = HH:MM:SS, 'iso' = full ISO timestamp. */
  time?: 'short' | 'iso'
}

export function renderRecord(r: TranscriptRecord, opts: RenderOpts = {}): string {
  const ts = opts.time === 'iso' ? r.ts : r.ts.slice(11, 19)
  switch (r.kind) {
    case 'msg':
      return `[${ts}] ${r.sender}: ${r.text}`
    case 'react':
      return `[${ts}] ${r.sender} ${r.emoji}`
    case 'pass': {
      const why = r.reason ? ` (${r.reason})` : ''
      return `[${ts}] ${r.sender} · pass${why}`
    }
  }
}
