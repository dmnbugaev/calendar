import { getCookie, getHeader, type H3Event } from 'h3'
import type { SessionService } from './session'
import type { SyncRepository } from './sync/repository'

/**
 * Защита серверных маршрутов владельцем приложения.
 * - Сессия: подписанная HMAC httpOnly cookie.
 * - CSRF: для мутаций проверяем Origin/Referer против хоста запроса.
 * - OAuth redirect_uri вычисляем из хоста (должен совпадать с
 *   зарегистрированным в Google Cloud Console).
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

const OWNER_SCOPED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface OwnerContext {
  session: SessionService
  repository: SyncRepository
  ownerEmail: string
  isProduction: boolean
}

/** Подписанная сессия владельца или null. */
export function getOwnerSession(ctx: OwnerContext, event: H3Event): { sub: string } | null {
  const cookie = getCookie(event, 'uni_session')
  const payload = ctx.session.parseCookieValue(cookie)
  return payload ? { sub: payload.sub } : null
}

/**
 * Требует активную сессию владельца. Бросает AuthError 401.
 */
export async function requireOwner(
  ctx: OwnerContext,
  event: H3Event,
): Promise<{ connectionId: number }> {
  const session = getOwnerSession(ctx, event)
  if (!session) {
    throw new AuthError('Требуется вход владельца', 401)
  }
  const connection = await ctx.repository.findConnectionBySub(session.sub)
  if (!connection || connection.status !== 'active') {
    throw new AuthError('Google-аккаунт не подключён или доступ отозван', 401)
  }
  if (ctx.ownerEmail && connection.email.toLowerCase() !== ctx.ownerEmail.toLowerCase()) {
    throw new AuthError('Доступ ограничен владельцем приложения', 403)
  }
  return { connectionId: connection.id }
}

/**
 * CSRF-защита мутаций: Origin/Referer должен совпадать с хостом запроса
 * (same-origin). SameSite=lax cookie + эта проверка достаточно для MVP.
 */
export function assertSameOrigin(event: H3Event): void {
  const method = event.method
  if (!OWNER_SCOPED_METHODS.has(method)) return

  const host = getHeader(event, 'host')
  if (!host) throw new AuthError('Отсутствует заголовок Host', 400)

  const origin = getHeader(event, 'origin') ?? getHeader(event, 'referer')
  if (!origin) {
    // Нет Origin/Referer — запрос не из браузера (curl). Для мутаций запрещён.
    throw new AuthError('Отсутствует заголовок Origin/Referer — мутация отклонена', 403)
  }
  const originHost = (() => {
    try {
      return new URL(origin).host
    } catch {
      return null
    }
  })()
  if (originHost !== host) {
    throw new AuthError('Cross-origin запрос отклонён (CSRF-защита)', 403)
  }
}

/** Redirect URI для OAuth — из env или вычисленный из хоста запроса. */
export function resolveRedirectUri(event: H3Event, configured: string): string {
  if (configured) return configured
  const proto = getHeader(event, 'x-forwarded-proto') ?? 'http'
  const host = getHeader(event, 'host')
  if (!host) throw new AuthError('Не удалось определить хост для redirect_uri', 500)
  return `${proto}://${host}/api/auth/google/callback`
}
