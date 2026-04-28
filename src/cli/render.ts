import type { TranscriptRecord } from '../shared/protocol.ts'

interface RenderOpts {
  /** 'short' = HH:MM:SS, 'iso' = full ISO timestamp. */
  time?: 'short' | 'iso'
}

export function renderRecord(r: TranscriptRecord, opts: RenderOpts = {}): string {
  const ts = opts.time === 'iso' ? r.ts : r.ts.slice(11, 19)
  const kind = r.kind ?? 'msg'
  switch (kind) {
    case 'msg': {
      const m = r as Extract<TranscriptRecord, { kind?: 'msg' }>
      return `[${ts}] ${m.sender}: ${m.text}`
    }
    case 'react': {
      const x = r as Extract<TranscriptRecord, { kind: 'react' }>
      return `[${ts}] ${x.sender} ${x.emoji}`
    }
    case 'pass': {
      const x = r as Extract<TranscriptRecord, { kind: 'pass' }>
      const why = x.reason ? ` (${x.reason})` : ''
      return `[${ts}] ${x.sender} · pass${why}`
    }
  }
}
