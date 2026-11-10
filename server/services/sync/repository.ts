import { and, desc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { NormalizedLesson, SyncRunStatus } from '#shared/types/sync'
import * as schemaModule from '../../db/schema'

const { calendarSettings, googleConnection, syncHistory, syncedEvent } = schemaModule

type CalendarSettingsRow = typeof schemaModule.calendarSettings.$inferSelect
type GoogleConnectionRow = typeof schemaModule.googleConnection.$inferSelect
type SyncHistoryRow = typeof schemaModule.syncHistory.$inferSelect

/**
 * SyncRepository — вся работа с PostgreSQL (Drizzle). Только
 * параметризованные запросы; транзакции для многошаговых операций.
 */

/** Позитивный уникальный конфликт = уже есть running-запуск. */
export class SyncLockedError extends Error {
  constructor() {
    super('Синхронизация уже выполняется')
    this.name = 'SyncLockedError'
  }
}

export interface CreateRunResult {
  runId: number
}

export interface FinishRunInput {
  runId: number
  status: SyncRunStatus
  createdCount: number
  updatedCount: number
  deletedCount: number
  unchangedCount: number
  errorCount: number
  errorDetails: string[]
  message: string
}

export class SyncRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schemaModule>) {}

  // ---------- connection ----------

  async findActiveConnection(): Promise<GoogleConnectionRow | null> {
    const rows = await this.db
      .select()
      .from(googleConnection)
      .where(eq(googleConnection.status, 'active'))
      .limit(1)
    return rows[0] ?? null
  }

  async findConnectionBySub(sub: string): Promise<GoogleConnectionRow | null> {
    const rows = await this.db
      .select()
      .from(googleConnection)
      .where(eq(googleConnection.googleSub, sub))
      .limit(1)
    return rows[0] ?? null
  }

  /** Сохранить/заменить подключение (один владелец — одна строка). */
  async upsertConnection(input: {
    googleSub: string
    email: string
    encryptedRefreshToken: string
    encryptedAccessToken: string
    accessTokenExpiresAt: Date
  }): Promise<GoogleConnectionRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(googleConnection)
        .values({
          googleSub: input.googleSub,
          email: input.email,
          encryptedRefreshToken: input.encryptedRefreshToken,
          encryptedAccessToken: input.encryptedAccessToken,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          status: 'active',
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: googleConnection.googleSub,
          set: {
            email: input.email,
            encryptedRefreshToken: input.encryptedRefreshToken,
            encryptedAccessToken: input.encryptedAccessToken,
            accessTokenExpiresAt: input.accessTokenExpiresAt,
            status: 'active',
            connectedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning()
      return row!
    })
  }

  async updateConnectionTokens(input: {
    connectionId: number
    encryptedAccessToken: string
    accessTokenExpiresAt: Date
  }): Promise<void> {
    await this.db
      .update(googleConnection)
      .set({
        encryptedAccessToken: input.encryptedAccessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(googleConnection.id, input.connectionId))
  }

  async markConnectionRevoked(connectionId: number): Promise<void> {
    await this.db
      .update(googleConnection)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(googleConnection.id, connectionId))
  }

  /** Полное отключение: revoke уже выполнен, удаляем строку (cascade). */
  async deleteConnection(connectionId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(calendarSettings).where(eq(calendarSettings.connectionId, connectionId))
      await tx.delete(syncedEvent).where(eq(syncedEvent.connectionId, connectionId))
      await tx.delete(googleConnection).where(eq(googleConnection.id, connectionId))
    })
  }

  // ---------- calendar settings ----------

  async findCalendarSettings(connectionId: number): Promise<CalendarSettingsRow | null> {
    const rows = await this.db
      .select()
      .from(calendarSettings)
      .where(eq(calendarSettings.connectionId, connectionId))
      .limit(1)
    return rows[0] ?? null
  }

  async upsertCalendarSettings(input: {
    connectionId: number
    calendarId: string
    calendarName: string
  }): Promise<void> {
    await this.db
      .insert(calendarSettings)
      .values({
        connectionId: input.connectionId,
        calendarId: input.calendarId,
        calendarName: input.calendarName,
      })
      .onConflictDoUpdate({
        target: calendarSettings.connectionId,
        set: { calendarId: input.calendarId, calendarName: input.calendarName },
      })
  }

  // ---------- sync history ----------

  /**
   * Создать запуск со статусом running. Уникальный частичный индекс
   * запрещает два running-запуска одного подключения.
   */
  async createRunningRun(connectionId: number): Promise<CreateRunResult> {
    try {
      const [row] = await this.db
        .insert(syncHistory)
        .values({ connectionId, status: 'running', startedAt: new Date() })
        .returning({ id: syncHistory.id })
      return { runId: row!.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('sync_history_one_running_uq')) {
        throw new SyncLockedError()
      }
      throw error
    }
  }

  async finishRun(input: FinishRunInput): Promise<void> {
    await this.db
      .update(syncHistory)
      .set({
        status: input.status,
        finishedAt: new Date(),
        createdCount: input.createdCount,
        updatedCount: input.updatedCount,
        deletedCount: input.deletedCount,
        unchangedCount: input.unchangedCount,
        errorCount: input.errorCount,
        errorDetails: input.errorDetails.length ? input.errorDetails : null,
        message: input.message,
      })
      .where(eq(syncHistory.id, input.runId))
  }

  /** Последний завершённый запуск для UI. */
  async findLastFinishedRun(connectionId: number): Promise<SyncHistoryRow | null> {
    const rows = await this.db
      .select()
      .from(syncHistory)
      .where(and(
        eq(syncHistory.connectionId, connectionId),
        eq(syncHistory.status, 'success'),
      ))
      .orderBy(desc(syncHistory.startedAt))
      .limit(1)
    return rows[0] ?? null
  }

  async findRecentRuns(connectionId: number, limit = 10): Promise<SyncHistoryRow[]> {
    return this.db
      .select()
      .from(syncHistory)
      .where(eq(syncHistory.connectionId, connectionId))
      .orderBy(desc(syncHistory.startedAt))
      .limit(limit)
  }

  // ---------- synced events ----------

  async listSyncedEvents(connectionId: number): Promise<{
    lessonKey: string
    googleEventId: string
    payloadHash: string
  }[]> {
    return this.db
      .select({
        lessonKey: syncedEvent.lessonKey,
        googleEventId: syncedEvent.googleEventId,
        payloadHash: syncedEvent.payloadHash,
      })
      .from(syncedEvent)
      .where(eq(syncedEvent.connectionId, connectionId))
  }

  async upsertSyncedEvent(input: {
    connectionId: number
    lesson: NormalizedLesson
    googleEventId: string
    payloadHashValue: string
  }): Promise<void> {
    await this.db
      .insert(syncedEvent)
      .values({
        connectionId: input.connectionId,
        lessonKey: input.lesson.key,
        googleEventId: input.googleEventId,
        payloadHash: input.payloadHashValue,
        startsAt: new Date(input.lesson.startsAt),
        endsAt: new Date(input.lesson.endsAt),
        subject: input.lesson.subject,
      })
      .onConflictDoUpdate({
        target: [syncedEvent.connectionId, syncedEvent.lessonKey],
        set: {
          googleEventId: input.googleEventId,
          payloadHash: input.payloadHashValue,
          startsAt: new Date(input.lesson.startsAt),
          endsAt: new Date(input.lesson.endsAt),
          subject: input.lesson.subject,
          updatedAt: new Date(),
        },
      })
  }

  async deleteSyncedEvent(connectionId: number, lessonKey: string): Promise<void> {
    await this.db
      .delete(syncedEvent)
      .where(and(
        eq(syncedEvent.connectionId, connectionId),
        eq(syncedEvent.lessonKey, lessonKey),
      ))
  }
}
