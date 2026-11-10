import { randomToken } from '../../../services/session'
import { buildServices } from '../../../services/factories'
import { assertSameOrigin, resolveRedirectUri } from '../../../services/owner'

/**
 * GET /api/auth/google — старт OAuth-флоу: state + PKCE в одноразовых
 * httpOnly cookie (10 минут), затем редирект на Google.
 */
export default defineEventHandler(async (event) => {
  const services = buildServices(event)

  if (!services.oauth || !services.oauthConfigured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OAuth не настроен: задайте NUXT_OAUTH_GOOGLE_CLIENT_ID и NUXT_OAUTH_GOOGLE_CLIENT_SECRET',
    })
  }
  if (!services.session || !services.encryptionKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Не заданы NUXT_SESSION_SECRET / NUXT_TOKEN_ENCRYPTION_KEY',
    })
  }

  // OAuth-старт — это GET-переход из UI; проверяем same-origin,
  // чтобы чужой сайт не инициировал флоу за пользователя.
  assertSameOrigin(event)

  const redirectUri = resolveRedirectUri(event, useRuntimeConfig(event).oauth.googleRedirectUri)
  const state = randomToken(24)
  const codeVerifier = randomToken(48)

  setCookie(event, 'uni_oauth_state', state, {
    httpOnly: true,
    secure: services.isProduction,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  setCookie(event, 'uni_oauth_verifier', codeVerifier, {
    httpOnly: true,
    secure: services.isProduction,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return sendRedirect(
    event,
    services.oauth.authorizeUrl({ state, codeVerifier, redirectUri }),
  )
})
