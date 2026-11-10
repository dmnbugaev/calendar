import { syncRequestSchema } from '#shared/schemas/api'
import type { SyncReport } from '#shared/types/sync'
import { GoogleCalendarService } from '../services/google/calendar'
import { buildServices } from '../services/factories'
import { assertSameOrigin, requireOwner } from '../services/owner'
import { SyncEngine } from '../services/sync/engine'
import { SyncLockedError } from '../services/sync/repository'
import { GoogleTokenManager, TokenRevokedError } from '../services/sync/token-manager'

/**
 * POST /api/sync — ручная синхронизация. Только владелец, same-origin,
 * защита от параллельных запусков (409 при втором запуске).
 */
export default defineEventHandler(async (event): Promise<SyncReport> => {
  const services = buildServices(event)
  if (!services.session || !services.repository || !services.encryptionKey) {
    throw createError({ statusCode: 503, statusMessage: 'Приложение не настроено' })
  }

  assertSameOrigin(event)

  const body = await readBody(event).catch(() => ({}))
  const { confirmMassDeletion } = syncRequestSchema.parse(body ?? {})

  const ownerCtx = {
    session: services.session,
    repository: services.repository,
    ownerEmail: services.ownerEmail,
    isProduction: services.isProduction,
  }
  const { connectionId } = await requireOwner(ownerCtx, event)

  const connection = await services.repository.findConnectionBySub(
    services.session.parseCookieValue(getCookie(event, 'uni_session'))?.sub ?? '',
  )
  if (!connection || connection.status !== 'active') {
    throw createError({ statusCode: 401, statusMessage: 'Google-аккаунт не подключён' })
  }

  const settings = await services.repository.findCalendarSettings(connectionId)
  if (!settings) {
    throw createError({ statusCode: 409, statusMessage: 'Календарь не создан — переподключите аккаунт' })
  }

  if (!services.oauth) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OAuth не настроен: задайте NUXT_OAUTH_GOOGLE_CLIENT_ID и NUXT_OAUTH_GOOGLE_CLIENT_SECRET',
    })
  }

  const tokenManager = new GoogleTokenManager(
    services.repository,
    services.oauth,
    connection,
    services.encryptionKey,
  )

  const engine = new SyncEngine({
    provider: services.scheduleProvider,
    calendar: new GoogleCalendarService(tokenManager),
    repository: services.repository,
    connectionId,
    calendarId: settings.calendarId,
  })

  try {
    return await engine.run({ confirmMassDeletion })
  } catch (error) {
    if (error instanceof SyncLockedError) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Синхронизация уже выполняется — дождитесь завершения',
      })
    }
    if (error instanceof TokenRevokedError) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Google-токен отозван — подключите аккаунт заново',
      })
    }
    throw error
  }
})
