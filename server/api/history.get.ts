import { buildServices } from '../services/factories'
import { assertSameOrigin, requireOwner } from '../services/owner'

/**
 * GET /api/history — последние запуски синхронизации (только владелец).
 */
export default defineEventHandler(async (event) => {
  const services = buildServices(event)
  if (!services.session || !services.repository) {
    throw createError({ statusCode: 503, statusMessage: 'Приложение не настроено' })
  }

  assertSameOrigin(event)

  const { connectionId } = await requireOwner(
    {
      session: services.session,
      repository: services.repository,
      ownerEmail: services.ownerEmail,
      isProduction: services.isProduction,
    },
    event,
  )

  const runs = await services.repository.findRecentRuns(connectionId, 10)

  return {
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdCount: run.createdCount,
      updatedCount: run.updatedCount,
      deletedCount: run.deletedCount,
      unchangedCount: run.unchangedCount,
      errorCount: run.errorCount,
      message: run.message,
    })),
  }
})
