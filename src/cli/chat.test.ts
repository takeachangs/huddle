import { describe, expect, test } from 'bun:test'
import { scrollDeltaForInput } from './chat.ts'

describe('chat scroll input', () => {
  test('arrow keys scroll by a small line increment', () => {
    expect(scrollDeltaForInput('\x1b[A', 24)).toBe(3)
    expect(scrollDeltaForInput('\x1b[B', 24)).toBe(-3)
  })

  test('page keys keep page-sized jumps', () => {
    expect(scrollDeltaForInput('\x1b[5~', 24)).toBe(17)
    expect(scrollDeltaForInput('\x1b[6~', 24)).toBe(-17)
  })
})
