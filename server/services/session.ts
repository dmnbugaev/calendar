import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Сессия владельца приложения. Cookie `uni_session` содержит base64url
 * payload + HMAC-подпись (ключ — NUXT_SESSION_SECRET). Секреты в клиент
 * не попадают; cookie httpOnly, sameSite=lax (нужен для OAuth redirect),
 * secure в production.
 */

const SESSION_COOKIE = 'uni_session'
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60 // 30 дней

interface SessionPayload {
  /** Google sub владельца. */
  sub: string
  /** Выдача сессии (unix, сек). */
  iat: number
}

export class SessionService {
  private readonly secret: string
  private readonly isProduction: boolean

  constructor(secret: string, isProduction: boolean) {
    if (!secret || secret.length < 16) {
      throw new Error('NUXT_SESSION_SECRET не задан или слишком короткий')
    }
    this.secret = secret
    this.isProduction = isProduction
  }

  createCookieValue(sub: string): string {
    const payload: SessionPayload = { sub, iat: Math.floor(Date.now() / 1000) }
    const body = encodeBase64Url(JSON.stringify(payload))
    const sig = this.sign(body)
    return `${body}.${sig}`
  }

  parseCookieValue(value: string | undefined): SessionPayload | null {
    if (!value) return null
    const [body, sig] = value.split('.')
    if (!body || !sig) return null
    if (!this.safeEqual(sig, this.sign(body))) return null
    try {
      const payload = JSON.parse(decodeBase64Url(body)) as SessionPayload
      if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number') return null
      const age = Math.floor(Date.now() / 1000) - payload.iat
      if (age > SESSION_MAX_AGE_S || age < -60) return null
      return payload
    } catch {
      return null
    }
  }

  setSessionCookie(event: H3Event, sub: string): void {
    setCookie(event, SESSION_COOKIE, this.createCookieValue(sub), {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_S,
      path: '/',
    })
  }

  clearSessionCookie(event: H3Event): void {
    deleteCookie(event, SESSION_COOKIE, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
    })
  }

  /** Подпись body (HMAC-SHA256, base64url). */
  private sign(body: string): string {
    const hmac = createHmac('sha256', this.secret).update(body).digest('base64url')
    return hmac
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }
}

/** Случайная строка для OAuth state / code_verifier. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
