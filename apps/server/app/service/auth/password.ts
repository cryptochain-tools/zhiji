import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 32
const SALT_LENGTH = 16
const N = 16_384
const R = 8
const P = 1

export class PasswordValidationError extends Error {}

/**
 * The encoded value is deliberately self describing so future work can rotate
 * password parameters without weakening verification of existing accounts.
 */
export async function hashPassword(password: string): Promise<string> {
  assertPassword(password)
  const salt = randomBytes(SALT_LENGTH)
  const derived = await derive(password, salt, KEY_LENGTH, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [ , nText, rText, pText, saltText, digestText ] = parts
  const n = Number(nText)
  const r = Number(rText)
  const p = Number(pText)
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || n < 2 || r < 1 || p < 1) return false
  try {
    const salt = Buffer.from(saltText!, 'base64url')
    const expected = Buffer.from(digestText!, 'base64url')
    if (salt.length < SALT_LENGTH || expected.length !== KEY_LENGTH) return false
    const actual = await derive(password, salt, expected.length, n, r, p)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function assertPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024 || value !== value.trim()) {
    throw new PasswordValidationError('Password must be 12 to 1024 characters without outer whitespace')
  }
}

function derive(password: string, salt: Buffer, length: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}
