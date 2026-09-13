import { createCipheriv, randomBytes } from 'node:crypto'

/**
 * The durable outbox is not a secret store.  Email and invitation token travel
 * only in this authenticated encrypted envelope, decrypted by a separately
 * configured worker delivery provider.
 */
export function createInvitationDeliveryEncryptor(encodedKey: string | undefined): ((value: { email: string; token: string }) => Record<string, unknown>) | null {
  if (!encodedKey) return null
  let key: Buffer
  try { key = Buffer.from(encodedKey, 'base64url') } catch { return null }
  if (key.length !== 32) return null
  return value => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([ cipher.update(JSON.stringify(value), 'utf8'), cipher.final() ])
    return { v: 1, alg: 'A256GCM', iv: iv.toString('base64url'), ciphertext: encrypted.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') }
  }
}
