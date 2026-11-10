import { timingSafeEqual } from 'node:crypto'
import type { SyncReport } from '#shared/types/sync'
import { GoogleCalendarService } from '../../services/google/calendar'
import { buildServices } from '../../services/factories'
import { SyncEngine } from '../../services/sync/engine'
import { SyncLockedError } from '../../services/sync/repository'
import { GoogleTokenManager } from '../../services/sync/token-manager'

/**
 * GET /api/cron/sync — ежедневная автосверка расписания (Vercel Cron).
 *
 * Расписание: 06:00 Europe/Moscow = 03:00 UTC → vercel.json `0 3 * * *`
 * (Moscow — фиксированный UTC+3, перехода на летнее время нет).
 *
 * Защита: Vercel передаёт `Authorization: Bearer ${CRON_SECRET}`;
 * маршрут отвечает только при точном совпадении. Посторонний вызов — 401.
 */

function secretMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false
  const a = Buffer.from(`Bearer ${expected}`)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export default defineEventHandler(async (event): Promise<{ ok: boolean; report?: SyncReport; message: string }> => {
  const services = buildServices(event)

  // Vercel подставляет именно переменную CRON_SECRET; NUXT_CRON_SECRET —
  // эквивалент для локальной разработки через runtimeConfig.
  const cronSecret = process.env.CRON_SECRET ?? useRuntimeConfig(event).cronSecret
  if (!cronSecret) {
    throw createError({ statusCode: 503, statusMessage: 'CRON_SECRET не настроен' })
  }
  if (!secretMatches(cronSecret, getHeader(event, 'authorization'))) {
    throw createError({ statusCode: 401, statusMessage: 'Неверный токен cron' })
  }

  if (!services.session || !services.repository || !services.encryptionKey || !services.oauth) {
    throw createError({ statusCode: 503, statusMessage: 'Приложение не настроено' })
  }

  const connection = await services.repository.findActiveConnection()
  if (!connection) {
    // Владелец ещё не подключил аккаунт — cron-запуск пропускается без ошибки.
    return { ok: false, message: 'Google-аккаунт не подключён — синхронизация пропущена' }
  }

  const settings = await services.repository.findCalendarSettings(connection.id)
  if (!settings) {
    return { ok: false, message: 'Календарь не создан — требуется переподключение аккаунта' }
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
    connectionId: connection.id,
    calendarId: settings.calendarId,
  })

  try {
    const report = await engine.run({ confirmMassDeletion: false })
    // Массовое удаление по cron НИКОГДА не выполняется автоматически:
    // требуется явное подтверждение владельца в интерфейсе.
    return { ok: report.status === 'success', report, message: report.message }
  } catch (error) {
    if (error instanceof SyncLockedError) {
      return { ok: false, message: 'Синхронизация уже выполняется (запущена вручную)' }
    }
    throw error
  }
})
