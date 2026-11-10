import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Схема БД UniCalendar (PostgreSQL / Supabase + Drizzle ORM).
 * Минимальный набор таблиц для MVP одного владельца.
 */

export const googleConnectionStatus = pgEnum('google_connection_status', [
  'active',
  'revoked',
])

export const syncRunStatus = pgEnum('sync_run_status', [
  'running',
  'success',
  'error',
  'blocked',
])

/** Подключённый Google-аккаунт владельца. */
export const googleConnection = pgTable(
  'google_connection',
  {
    id: serial('id').primaryKey(),
    /** Google account id (sub). */
    googleSub: text('google_sub').notNull().unique(),
    email: text('email').notNull(),
    /** Refresh token в зашифрованном виде (AES-256-GCM). */
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    /** Кэш access token (тоже зашифрован) + время истечения. */
    encryptedAccessToken: text('encrypted_access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    status: googleConnectionStatus('status').notNull().default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('google_connection_status_idx').on(table.status)],
)

/** Настройки целевого календаря Google. */
export const calendarSettings = pgTable(
  'calendar_settings',
  {
    id: serial('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnection.id, { onDelete: 'cascade' }),
    /** Google Calendar ID созданного/привязанного календаря. */
    calendarId: text('calendar_id').notNull(),
    /** Название календаря, например «Московский Политех | 251-362». */
    calendarName: text('calendar_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('calendar_settings_connection_id_uq').on(table.connectionId),
  ],
)

/** События Google, созданные приложением (для идемпотентной сверки). */
export const syncedEvent = pgTable(
  'synced_event',
  {
    id: serial('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnection.id, { onDelete: 'cascade' }),
    /** Стабильный ключ занятия (см. server/services/sync/matching.ts). */
    lessonKey: text('lesson_key').notNull(),
    /** ID события в Google Calendar. */
    googleEventId: text('google_event_id').notNull(),
    /** Хеш нормализованного payload на момент записи. */
    payloadHash: text('payload_hash').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('synced_event_connection_key_uq').on(table.connectionId, table.lessonKey),
    uniqueIndex('synced_event_google_event_id_uq').on(table.googleEventId),
    index('synced_event_starts_at_idx').on(table.startsAt),
  ],
)

/** Журнал синхронизаций. */
export const syncHistory = pgTable(
  'sync_history',
  {
    id: serial('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => googleConnection.id, { onDelete: 'cascade' }),
    status: syncRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    deletedCount: integer('deleted_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    errorDetails: jsonb('error_details').$type<string[]>(),
    /** Сообщение о результате (для журнала в UI). */
    message: text('message'),
  },
  (table) => [
    index('sync_history_connection_started_idx').on(table.connectionId, table.startedAt),
    // Защита от параллельных запусков: у одного подключения может быть
    // только ОДИН запуск в статусе running (попытка второго упадёт по unique).
    uniqueIndex('sync_history_one_running_uq')
      .on(table.connectionId)
      .where(sql`status = 'running'`),
  ],
)

export type GoogleConnectionRow = typeof googleConnection.$inferSelect
export type CalendarSettingsRow = typeof calendarSettings.$inferSelect
export type SyncedEventRow = typeof syncedEvent.$inferSelect
export type SyncHistoryRow = typeof syncHistory.$inferSelect
