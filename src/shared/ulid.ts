// Minimal ULID generator. Crockford's base32, 48-bit timestamp + 80-bit random.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encode(value: number, length: number): string {
  let out = ''
  for (let i = length - 1; i >= 0; i--) {
    out = ALPHABET[value % 32] + out
    value = Math.floor(value / 32)
  }
  return out
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return bytes
}

export function ulid(now: number = Date.now()): string {
  const time = encode(now, 10)
  const bytes = randomBytes(10)
  let rand = ''
  for (let i = 0; i < 16; i++) {
    // Pack 5 bits at a time from the random bytes.
    const byteIdx = Math.floor((i * 5) / 8)
    const bitOffset = (i * 5) % 8
    const a = bytes[byteIdx] ?? 0
    const b = bytes[byteIdx + 1] ?? 0
    const combined = ((a << 8) | b) >>> (16 - 5 - bitOffset)
    rand += ALPHABET[combined & 31]
  }
  return time + rand
}
