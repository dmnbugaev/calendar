import type { StatusResponse } from '#shared/types/sync'
import { buildServices } from '../services/factories'
import { getOwnerSession } from '../services/owner'

/**
 * GET /api/status — статус для главной страницы.
 * Неавторизованному пользователю возвращается только connected=false
 * (никакой информации о владельце не раскрывается).
 */
export default defineEventHandler(async (event): Promise<StatusResponse> => {
  const services = buildServices(event)

  if (!services.repository || !services.session) {
    return {
      connected: false,
      email: null,
      calendarName: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      authenticated: false,
    }
  }

  const session = getOwnerSession(
    {
      session: services.session,
      repository: services.repository,
      ownerEmail: services.ownerEmail,
      isProduction: services.isProduction,
    },
    event,
  )
  if (!session) {
    return {
      connected: false,
      email: null,
      calendarName: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      authenticated: false,
    }
  }

  const connection = await services.repository.findConnectionBySub(session.sub)
  if (!connection || connection.status !== 'active') {
    return {
      connected: false,
      email: null,
      calendarName: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      authenticated: true,
    }
  }

  const calendar = await services.repository.findCalendarSettings(connection.id)
  const lastRun = await services.repository.findLastFinishedRun(connection.id)

  return {
    connected: true,
    email: connection.email,
    calendarName: calendar?.calendarName ?? null,
    lastSyncAt: lastRun?.finishedAt?.toISOString() ?? null,
    lastSyncStatus: (lastRun?.status as StatusResponse['lastSyncStatus']) ?? null,
    authenticated: true,
  }
})
