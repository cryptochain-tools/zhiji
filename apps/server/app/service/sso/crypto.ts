import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
export function createEnvelopeCipher(key: string | undefined): { seal(value: string): Buffer; unseal(value: Buffer): string } | null {
  if (!key) return null
  let material: Buffer
  try { material = Buffer.from(key, 'base64url') } catch { return null }
  if (material.length !== 32) return null
  return { seal(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', material, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]) }, unseal(value) { if (value.length < 29) throw new Error('invalid sealed OIDC value'); const decipher = createDecipheriv('aes-256-gcm', material, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8') } }
}
