import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../../server/services/crypto'
import { SessionService } from '../../server/services/session'

describe('crypto (AES-256-GCM)', () => {
  const secret = 'test-encryption-key-very-secret-1234'

  it('шифрует и расшифровывает значение', () => {
    const encrypted = encryptSecret('ya29.refresh-token-value', secret)
    expect(encrypted).not.toContain('ya29')
    expect(decryptSecret(encrypted, secret)).toBe('ya29.refresh-token-value')
  })

  it('разный секрет не расшифровывает', () => {
    const encrypted = encryptSecret('secret-value', secret)
    expect(() => decryptSecret(encrypted, 'another-key-entirely-different')).toThrow()
  })

  it('короткий секрет запрещён', () => {
    expect(() => encryptSecret('value', 'short')).toThrow(/ENCRYPTION_KEY/)
  })
})

describe('session (HMAC cookie)', () => {
  const service = new SessionService('test-session-secret-123456', false)

  it('создаёт и разбирает cookie', () => {
    const value = service.createCookieValue('user@example.com')
    const parsed = service.parseCookieValue(value)
    expect(parsed?.sub).toBe('user@example.com')
  })

  it('портит подпись — отклоняет', () => {
    const value = service.createCookieValue('user@example.com')
    const tampered = value.slice(0, -4) + 'AAAA'
    expect(service.parseCookieValue(tampered)).toBeNull()
  })

  it('чужой секрет — отклоняет', () => {
    const other = new SessionService('another-session-secret-98765', false)
    const value = other.createCookieValue('user@example.com')
    expect(service.parseCookieValue(value)).toBeNull()
  })

  it('просроченная сессия отклоняется', () => {
    const expired = new SessionService('test-session-secret-123456', false)
    const value = expired.createCookieValue('user@example.com')
    // Манипулируем временем: iat в payload старый.
    const [body] = value.split('.')
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'))
    payload.iat = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60
    const newBody = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = value.split('.')[1]
    expect(service.parseCookieValue(`${newBody}.${sig}`)).toBeNull()
  })
})
