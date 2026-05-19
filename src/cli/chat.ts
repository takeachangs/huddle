import { openCli, type CliConnection } from './client.ts'
import type { SessionInfo, TranscriptRecord } from '../shared/protocol.ts'

const ESC = '\x1b'
const ENTER_ALT = `${ESC}[?1049h`
const EXIT_ALT = `${ESC}[?1049l`
const CLEAR = `${ESC}[2J${ESC}[H`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const ARROW_SCROLL_LINES = 3

type StatusKind = 'idle' | 'info' | 'error'

interface FooterLayout {
  lines: string[]
  cursorLine: number
  cursorCol: number
}

interface State {
  records: TranscriptRecord[]
  sessions: SessionInfo[]
  input: string
  cursor: number
  scrollOffset: number
  status: string
  statusKind: StatusKind
  pendingSends: number
  closed: boolean
}

export async function chat(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error('huddle chat requires an interactive terminal; use huddle tail or huddle send in non-TTY mode')
  }

  const cli = await openCli()
  const ui = new ChatUi(cli)
  await ui.run()
}

function printHelp(): void {
  process.stderr.write(
    `Usage: huddle chat\n\n` +
      `Open an interactive fullscreen huddle chat UI.\n`,
  )
}

class ChatUi {
  private readonly state: State = {
    records: [],
    sessions: [],
    input: '',
    cursor: 0,
    scrollOffset: 0,
    status: 'Enter send · Ctrl+C quit · ↑/↓ fine scroll · PgUp/PgDn page',
    statusKind: 'idle',
    pendingSends: 0,
    closed: false,
  }
  private renderScheduled = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private oldRawMode = false

  constructor(private readonly cli: CliConnection) {}

  async run(): Promise<void> {
    this.oldRawMode = Boolean(process.stdin.isRaw)
    this.enterScreen()
    try {
      this.cli.on(frame => {
        switch (frame.t) {
          case 'tail_event':
            this.state.records.push(frame.record)
            this.clampScroll()
            this.scheduleRender()
            return
          case 'log':
            this.state.records = frame.messages
            this.clampScroll()
            this.scheduleRender()
            return
          case 'sessions':
            this.state.sessions = frame.sessions
            this.scheduleRender()
            return
          case 'ack':
            if (this.state.pendingSends > 0) {
              this.state.pendingSends--
              this.setStatus('sent', 'info', 1200)
            }
            return
          case 'error':
            if (this.state.pendingSends > 0) this.state.pendingSends--
            this.setStatus(frame.reason, 'error')
            return
          case 'welcome':
          case 'message':
            return
        }
      })

      this.cli.send({ t: 'read_log', limit: 50 })
      this.cli.send({ t: 'subscribe_tail' })
      this.cli.send({ t: 'list_sessions' })
      this.pollTimer = setInterval(() => this.cli.send({ t: 'list_sessions' }), 5000)
      this.scheduleRender()

      await new Promise<void>(resolve => {
        const onData = (chunk: Buffer): void => this.handleInput(chunk, resolve)
        const onResize = (): void => this.scheduleRender()
        process.stdin.on('data', onData)
        process.stdout.on('resize', onResize)
        this.cleanup = () => {
          process.stdin.off('data', onData)
          process.stdout.off('resize', onResize)
          resolve()
        }
      })
    } finally {
      if (!this.state.closed) this.close()
    }
  }

  private cleanup: () => void = () => {}

  private enterScreen(): void {
    process.stdout.write(ENTER_ALT + HIDE_CURSOR + CLEAR)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.on('exit', this.restoreScreen)
  }

  private restoreScreen = (): void => {
    process.off('exit', this.restoreScreen)
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    try {
      process.stdin.setRawMode(this.oldRawMode)
    } catch {
      // stdin can already be gone during process shutdown.
    }
    this.cli.close()
    process.stdout.write(SHOW_CURSOR + EXIT_ALT)
  }

  private close(): void {
    if (this.state.closed) return
    this.state.closed = true
    this.restoreScreen()
    this.cleanup()
  }

  private handleInput(chunk: Buffer, done: () => void): void {
    const text = chunk.toString('utf8')
    if (text === '\x03') {
      this.close()
      done()
      return
    }
    if (text === '\x0c') {
      this.scheduleRender()
      return
    }
    if (text === '\x15') {
      this.state.input = ''
      this.state.cursor = 0
      this.scheduleRender()
      return
    }
    if (text === '\r' || text === '\n') {
      this.submit()
      return
    }
    if (isBackspaceInput(text)) {
      this.deleteBeforeCursor()
      return
    }

    const scrollDelta = scrollDeltaForInput(text, process.stdout.rows || 24)
    if (scrollDelta !== 0) {
      this.state.scrollOffset += scrollDelta
      this.clampScroll()
      this.scheduleRender()
      return
    }

    switch (text) {
      case `${ESC}[D`:
        this.state.cursor = previousCodePointIndex(this.state.input, this.state.cursor)
        this.scheduleRender()
        return
      case `${ESC}[C`:
        this.state.cursor = nextCodePointIndex(this.state.input, this.state.cursor)
        this.scheduleRender()
        return
      case `${ESC}[3~`:
        this.deleteAfterCursor()
        return
    }

    if (isPrintable(text)) {
      this.state.input =
        this.state.input.slice(0, this.state.cursor) +
        text +
        this.state.input.slice(this.state.cursor)
      this.state.cursor += text.length
      this.scheduleRender()
    }
  }

  private submit(): void {
    const input = this.state.input.trim()
    if (!input) return
    this.state.input = ''
    this.state.cursor = 0
    this.state.pendingSends++
    this.setStatus('sending...', 'info')
    this.cli.send({ t: 'send', text: input })
    this.scheduleRender()
  }

  private deleteBeforeCursor(): void {
    if (this.state.cursor <= 0) return
    const start = previousCodePointIndex(this.state.input, this.state.cursor)
    this.state.input = this.state.input.slice(0, start) + this.state.input.slice(this.state.cursor)
    this.state.cursor = start
    this.scheduleRender()
  }

  private deleteAfterCursor(): void {
    if (this.state.cursor >= this.state.input.length) return
    const end = nextCodePointIndex(this.state.input, this.state.cursor)
    this.state.input = this.state.input.slice(0, this.state.cursor) + this.state.input.slice(end)
    this.scheduleRender()
  }

  private setStatus(message: string, kind: StatusKind, clearAfterMs?: number): void {
    this.state.status = message
    this.state.statusKind = kind
    if (this.statusTimer) clearTimeout(this.statusTimer)
    if (clearAfterMs) {
      this.statusTimer = setTimeout(() => {
        this.state.status = 'Enter send · Ctrl+C quit · ↑/↓ fine scroll · PgUp/PgDn page'
        this.state.statusKind = 'idle'
        this.scheduleRender()
      }, clearAfterMs)
    }
    this.scheduleRender()
  }

  private scheduleRender(): void {
    if (this.renderScheduled || this.state.closed) return
    this.renderScheduled = true
    queueMicrotask(() => {
      this.renderScheduled = false
      if (!this.state.closed) this.render()
    })
  }

  private render(): void {
    const width = process.stdout.columns || 80
    const height = process.stdout.rows || 24
    const headerLines = this.renderHeader(width)
    const footer = this.renderFooter(width)
    const transcriptHeight = Math.max(0, height - headerLines.length - footer.lines.length)
    const transcriptLines = this.renderTranscript(width)
    const maxScroll = Math.max(0, transcriptLines.length - transcriptHeight)
    this.state.scrollOffset = Math.min(this.state.scrollOffset, maxScroll)
    const start = Math.max(0, transcriptLines.length - transcriptHeight - this.state.scrollOffset)
    const visibleTranscript = transcriptLines.slice(start, start + transcriptHeight)

    const lines = [
      ...headerLines,
      ...padLines(visibleTranscript, transcriptHeight, ''),
      ...footer.lines,
    ].slice(0, height)

    process.stdout.write(
      CLEAR +
        lines.map(line => fit(line, width)).join('\n') +
        this.cursorPosition(headerLines.length + transcriptHeight, footer),
    )
  }

  private renderHeader(width: number): string[] {
    const names = this.state.sessions.map(s => s.name).join(' ')
    const title = ` huddle main `
    const summary = `${this.state.sessions.length} session${this.state.sessions.length === 1 ? '' : 's'} online`
    const top = `${title}${' '.repeat(Math.max(1, width - title.length - summary.length))}${summary}`
    const sessionLine = names ? ` ${names}` : ' no Claude sessions connected'
    return [top, dim(fit(sessionLine, width)), rule(width)]
  }

  private renderTranscript(width: number): string[] {
    if (this.state.records.length === 0) {
      return ['', dim('  No messages yet. Type below to start the huddle.')]
    }

    const out: string[] = []
    this.state.records.forEach((record, index) => {
      if (record.kind === 'msg') {
        const route = record.mentions.length > 0 ? ` -> ${record.mentions.map(m => `@${m}`).join(', ')}` : ''
        if (out.length > 0) {
          out.push('')
        }
        out.push(`${green('•')} ${bold(`${record.sender}${route}`)}`)
        out.push(...renderMarkdown(record.text, Math.max(12, width - 4)).map(line => `  ${line}`))
      } else if (record.kind === 'react') {
        out.push(dim(`  ◦ ${record.sender}  ${record.emoji}`))
      } else {
        const why = record.reason ? `  ${record.reason}` : ''
        out.push(dim(`  ◦ ${record.sender} · pass${why}`))
      }
      if (index === this.state.records.length - 1) out.push('')
    })
    return out
  }

  private renderFooter(width: number): FooterLayout {
    const status = this.state.statusKind === 'error'
      ? red(this.state.status)
      : this.state.statusKind === 'info'
        ? cyan(this.state.status)
        : dim(this.state.status)
    const inputLayout = wrapInput(this.state.input, Math.max(1, width - 2), this.state.cursor)
    const inputLines = inputLayout.lines.map((line, index) => `${index === 0 ? '❯ ' : '  '}${line}`)
    return {
      lines: [
      rule(width),
      '',
        ...inputLines.map(line => fit(line, width)),
      '',
      fit(status, width),
      ],
      cursorLine: 2 + inputLayout.cursorLine,
      cursorCol: 2 + inputLayout.cursorCol,
    }
  }

  private cursorPosition(footerTopRows: number, footer: FooterLayout): string {
    const row = Math.max(1, footerTopRows + footer.cursorLine + 1)
    const col = Math.max(1, footer.cursorCol)
    return `${ESC}[${row};${col}H${SHOW_CURSOR}`
  }

  private pageSize(): number {
    const height = process.stdout.rows || 24
    return pageSizeForHeight(height)
  }

  private clampScroll(): void {
    const width = process.stdout.columns || 80
    const height = process.stdout.rows || 24
    const transcriptHeight = Math.max(0, height - this.renderHeader(width).length - this.renderFooter(width).lines.length)
    const maxScroll = Math.max(0, this.renderTranscript(width).length - transcriptHeight)
    this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxScroll))
  }
}

export function scrollDeltaForInput(text: string, terminalHeight: number): number {
  switch (text) {
    case `${ESC}[A`:
      return ARROW_SCROLL_LINES
    case `${ESC}[B`:
      return -ARROW_SCROLL_LINES
    case `${ESC}[5~`:
      return pageSizeForHeight(terminalHeight)
    case `${ESC}[6~`:
      return -pageSizeForHeight(terminalHeight)
    default:
      return 0
  }
}

function pageSizeForHeight(height: number): number {
  return Math.max(1, height - 7)
}

function isPrintable(text: string): boolean {
  return !text.includes(ESC) && !/[\x00-\x08\x0b-\x1f\x7f]/.test(text)
}

function isBackspaceInput(text: string): boolean {
  return (
    text === '\x7f' ||
    text === '\b' ||
    text === `${ESC}[127~` ||
    /^\x1b\[127(?:;\d+)?u$/.test(text) ||
    /^\x1b\[8(?:;\d+)?u$/.test(text)
  )
}

function padLines(lines: string[], count: number, fill: string): string[] {
  const out = lines.slice(0, count)
  while (out.length < count) out.push(fill)
  return out
}

function wrapInput(input: string, width: number, cursor: number): {
  lines: string[]
  cursorLine: number
  cursorCol: number
} {
  const lines: { text: string; start: number; end: number }[] = []
  let line = ''
  let lineStart = 0
  let lineWidth = 0

  for (let index = 0; index < input.length;) {
    const code = input.codePointAt(index) ?? 0
    const step = code > 0xffff ? 2 : 1
    const value = input.slice(index, index + step)
    const valueWidth = cellWidth(value)
    if (lineWidth > 0 && lineWidth + valueWidth > width) {
      lines.push({ text: line, start: lineStart, end: index })
      line = ''
      lineStart = index
      lineWidth = 0
    }
    line += value
    lineWidth += valueWidth
    index += step
  }

  lines.push({ text: line, start: lineStart, end: input.length })

  let cursorLine = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i]!
    if (cursor >= entry.start && (cursor < entry.end || i === lines.length - 1)) {
      cursorLine = i
      break
    }
  }

  const lineForCursor = lines[cursorLine]!
  const cursorInLine = input.slice(lineForCursor.start, cursor)
  return {
    lines: lines.map(entry => entry.text),
    cursorLine,
    cursorCol: cellWidth(cursorInLine) + 1,
  }
}

function previousCodePointIndex(text: string, index: number): number {
  if (index <= 0) return 0
  let previous = index - 1
  const code = text.charCodeAt(previous)
  if (code >= 0xdc00 && code <= 0xdfff && previous > 0) {
    const before = text.charCodeAt(previous - 1)
    if (before >= 0xd800 && before <= 0xdbff) previous--
  }
  return previous
}

function nextCodePointIndex(text: string, index: number): number {
  if (index >= text.length) return text.length
  const code = text.charCodeAt(index)
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2
  }
  return index + 1
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/(\s+)/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    if (!line) {
      line = word.trimStart()
    } else if (cellWidth(line) + cellWidth(word) <= width) {
      line += word
    } else {
      lines.push(line.trimEnd())
      line = word.trimStart()
    }
    while (cellWidth(line) > width) {
      const [head, tail] = splitByCellWidth(line, width)
      lines.push(head)
      line = tail.trimStart()
    }
  }
  if (line) lines.push(line.trimEnd())
  return lines.length > 0 ? lines : ['']
}

function renderMarkdown(text: string, width: number): string[] {
  const out: string[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let inFence = false
  let fenceLang = ''

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    const fenceMatch = line.match(/^\s*```(\S*)?\s*$/)
    if (fenceMatch) {
      inFence = !inFence
      fenceLang = inFence ? fenceMatch[1] ?? '' : ''
      if (inFence && fenceLang) out.push(dim(`code ${fenceLang}`))
      continue
    }

    if (inFence) {
      const codeLine = line.length > 0 ? dim(`  ${line}`) : ''
      out.push(...wrap(codeLine, width))
      continue
    }

    if (line.trim() === '') {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      out.push(...wrap(bold(formatInline(heading[2]!.trim())), width))
      continue
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/)
    if (quote) {
      out.push(...wrap(dim(`│ ${formatInline(quote[1] ?? '')}`), width))
      continue
    }

    const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (unordered) {
      const indent = ' '.repeat(Math.min(6, Math.floor(unordered[1]!.length / 2) * 2))
      out.push(...wrapWithHangingIndent(`${indent}• ${formatInline(unordered[2]!)}`, width, `${indent}  `))
      continue
    }

    const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (ordered) {
      const indent = ' '.repeat(Math.min(6, Math.floor(ordered[1]!.length / 2) * 2))
      const marker = `${line.trimStart().match(/^\d+/)?.[0] ?? '1'}. `
      out.push(...wrapWithHangingIndent(`${indent}${marker}${formatInline(ordered[2]!)}`, width, `${indent}${' '.repeat(marker.length)}`))
      continue
    }

    out.push(...wrap(formatInline(line), width))
  }

  while (out.length > 1 && out[out.length - 1] === '') out.pop()
  return out.length > 0 ? out : ['']
}

function wrapWithHangingIndent(text: string, width: number, hangingIndent: string): string[] {
  const wrapped = wrap(text, width)
  if (wrapped.length <= 1) return wrapped
  return wrapped.map((line, index) => index === 0 ? line : `${hangingIndent}${line.trimStart()}`)
}

function formatInline(text: string): string {
  let out = text
  out = out.replace(/`([^`]+)`/g, (_, code: string) => cyan(code))
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, value: string) => bold(value))
  out = out.replace(/__([^_]+)__/g, (_, value: string) => bold(value))
  out = out.replace(/(^|[^\*])\*([^*\n]+)\*/g, (_match: string, prefix: string, value: string) => `${prefix}${value}`)
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, (_match: string, prefix: string, value: string) => `${prefix}${value}`)
  return out
}

function fit(text: string, width: number): string {
  const len = cellWidth(text)
  if (len === width) return text
  if (len < width) return text + ' '.repeat(width - len)
  return truncateByCellWidth(text, Math.max(0, width - 1)) + '…'
}

function rule(width: number): string {
  return dim('─'.repeat(Math.max(1, width)))
}

function cellWidth(text: string): number {
  let width = 0
  for (const char of stripAnsi(text)) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0) continue
    if (code < 32 || (code >= 0x7f && code < 0xa0)) continue
    width += isWide(code) ? 2 : 1
  }
  return width
}

function splitByCellWidth(text: string, maxWidth: number): [string, string] {
  let width = 0
  let index = 0
  for (let i = 0; i < text.length;) {
    if (text[i] === ESC && text[i + 1] === '[') {
      const end = text.indexOf('m', i + 2)
      if (end === -1) break
      index = end + 1
      i = end + 1
      continue
    }
    const code = text.codePointAt(i) ?? 0
    const step = code > 0xffff ? 2 : 1
    const value = text.slice(i, i + step)
    const charWidth = cellWidth(value)
    if (width + charWidth > maxWidth) break
    width += charWidth
    index += value.length
    i += step
  }
  return [text.slice(0, index), text.slice(index)]
}

function truncateByCellWidth(text: string, maxWidth: number): string {
  return splitByCellWidth(stripAnsi(text), maxWidth)[0]
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function isWide(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff))
  )
}

function bold(text: string): string {
  return `${ESC}[1m${text}${ESC}[22m`
}

function dim(text: string): string {
  return `${ESC}[2m${text}${ESC}[22m`
}

function red(text: string): string {
  return `${ESC}[31m${text}${ESC}[39m`
}

function cyan(text: string): string {
  return `${ESC}[36m${text}${ESC}[39m`
}

function green(text: string): string {
  return `${ESC}[32m${text}${ESC}[39m`
}
