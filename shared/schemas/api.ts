import { z } from 'zod'

/**
 * Zod-схемы контрактов клиент↔сервер. Типы выводятся через z.infer,
 * дублирование вручную запрещено.
 */

export const syncRunStatusSchema = z.enum(['running', 'success', 'error', 'blocked'])

export const syncReportSchema = z.object({
  runId: z.number().nullable(),
  status: syncRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  message: z.string(),
  errorDetails: z.array(z.string()),
  massDeletionBlocked: z.boolean(),
})

export const statusResponseSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
  calendarName: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncStatus: z.enum(['success', 'error', 'blocked']).nullable(),
  authenticated: z.boolean(),
})

/** Занятие для предпросмотра (GET /api/schedule/preview). */
export const previewLessonSchema = z.object({
  date: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  title: z.string(),
  subject: z.string(),
  lessonType: z.string().nullable(),
  teacher: z.string(),
  location: z.string(),
  building: z.string().nullable(),
  room: z.string().nullable(),
  sourceUrl: z.string(),
})

export const schedulePreviewSchema = z.object({
  group: z.string(),
  from: z.string(),
  to: z.string(),
  fetchedAt: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      lessons: z.array(previewLessonSchema),
    }),
  ),
})

/** Тело POST /api/sync. */
export const syncRequestSchema = z.object({
  /** Явное подтверждение массового удаления (защитный порог >50%). */
  confirmMassDeletion: z.boolean().optional().default(false),
})
