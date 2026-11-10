import { encryptSecret } from '../../../services/crypto'
import { GoogleCalendarService, SCHEDULE_CALENDAR_NAME } from '../../../services/google/calendar'
import { buildServices } from '../../../services/factories'
import { resolveRedirectUri } from '../../../services/owner'

/**
 * GET /api/auth/google/callback — OAuth callback.
 *
 * Порядок: сверка state (одноразовая cookie), обмен кода с PKCE,
 * определение email (id primary-календаря), проверка владельца
 * (NUXT_OWNER_EMAIL) — чужой аккаунт сразу отзывается, создание
 * целевого календаря, сохранение подключения, сессия.
 */
export default defineEventHandler(async (event) => {
  const services = buildServices(event)
  const query = getQuery(event)

  const fail = (reason: string) =>
    sendRedirect(event, `/?authError=${encodeURIComponent(reason)}`)

  if (!services.oauth || !services.oauthConfigured
    || !services.session || !services.encryptionKey || !services.repository) {
    return fail('Приложение не настроено: проверьте переменные окружения (см. .env.example)')
  }
  if (!services.ownerEmail) {
    return fail('Не задан NUXT_OWNER_EMAIL — подключение сторонних аккаунтов запрещено')
  }

  const stateCookie = getCookie(event, 'uni_oauth_state')
  const verifierCookie = getCookie(event, 'uni_oauth_verifier')
  // Одноразовые cookie: удаляем сразу.
  deleteCookie(event, 'uni_oauth_state', { path: '/' })
  deleteCookie(event, 'uni_oauth_verifier', { path: '/' })

  if (typeof query.error === 'string') {
    return fail(`Google отклонил авторизацию: ${query.error}`)
  }
  if (typeof query.code !== 'string' || typeof query.state !== 'string'
    || !stateCookie || !verifierCookie) {
    return fail('Некорректный OAuth-ответ: отсутствуют code/state')
  }
  if (query.state !== stateCookie) {
    return fail('Проверка OAuth state не пройдена — возможно, подмена запроса')
  }

  const redirectUri = resolveRedirectUri(event, useRuntimeConfig(event).oauth.googleRedirectUri)

  let accessToken: string
  let refreshToken: string | null
  try {
    const tokens = await services.oauth.exchangeCode({
      code: query.code,
      codeVerifier: verifierCookie,
      redirectUri,
    })
    accessToken = tokens.accessToken
    refreshToken = tokens.refreshToken
    if (!refreshToken) {
      return fail('Google не вернул refresh token — повторите вход (prompt=consent обязателен)')
    }
  } catch {
    return fail('Не удалось обменять код авторизации на токены')
  }

  let userInfo
  try {
    userInfo = await services.oauth.fetchUserInfo(accessToken)
  } catch {
    return fail('Не удалось определить аккаунт Google')
  }

  // Владелец: email должен совпадать со значением NUXT_OWNER_EMAIL.
  if (userInfo.email.toLowerCase() !== services.ownerEmail.toLowerCase()) {
    // Чужой аккаунт: сразу отзываем выданные токены.
    await services.oauth.revokeToken(accessToken)
    await services.oauth.revokeToken(refreshToken)
    return fail('Доступ ограничен владельцем приложения — этот аккаунт не может быть подключён')
  }

  // Создаём (или находим) отдельный календарь расписания.
  const calendarService = new GoogleCalendarService({
    getToken: async () => accessToken,
    refresh: async () => accessToken,
  })
  let calendarId: string
  try {
    calendarId = await calendarService.ensureScheduleCalendar(SCHEDULE_CALENDAR_NAME)
  } catch {
    return fail('Не удалось создать календарь расписания в Google')
  }

  const now = new Date()
  await services.repository.upsertConnection({
    googleSub: userInfo.sub,
    email: userInfo.email,
    encryptedRefreshToken: encryptSecret(refreshToken, services.encryptionKey),
    encryptedAccessToken: encryptSecret(accessToken, services.encryptionKey),
    accessTokenExpiresAt: new Date(now.getTime() + 3600 * 1000),
  })
  const connection = await services.repository.findConnectionBySub(userInfo.sub)
  if (connection) {
    await services.repository.upsertCalendarSettings({
      connectionId: connection.id,
      calendarId,
      calendarName: SCHEDULE_CALENDAR_NAME,
    })
  }

  services.session.setSessionCookie(event, userInfo.sub)
  return sendRedirect(event, '/?authSuccess=1')
})
