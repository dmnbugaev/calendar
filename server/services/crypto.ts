import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Шифрование чувствительных значений (refresh token) AES-256-GCM.
 * Ключ — 32 байта из NUXT_TOKEN_ENCRYPTION_KEY (base64 или произвольная
 * строка достаточной энтропии; в репозитории значения нет).
 */

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CryptoConfigError'
  }
}

/** Выводит стабильный 32-байтный ключ из значения env. */
function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new CryptoConfigError(
      'NUXT_TOKEN_ENCRYPTION_KEY не задан или слишком короткий (минимум 16 символов)',
    )
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

/** Шифрует строку; результат — base64(iv|tag|ciphertext). */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

/** Расшифровывает строку, зашифрованную encryptSecret. */
export function decryptSecret(encoded: string, secret: string): string {
  const key = deriveKey(secret)
  const data = Buffer.from(encoded, 'base64')
  if (data.length <= 12 + 16) {
    throw new CryptoConfigError('Повреждённый формат зашифрованного значения')
  }
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
