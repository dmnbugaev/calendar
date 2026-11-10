import type { NormalizedLesson, SyncReport } from '#shared/types/sync'
import type {
  GoogleCalendarService,
  CalendarEvent,
  GoogleEventPayload,
} from '../google/calendar'
import {
  CalendarAccessRevokedError,
  GoogleCalendarError,
} from '../google/calendar'
import { MASS_DELETION_THRESHOLD, normalizeSchedule, payloadHash } from '../schedule/normalizer'
import { MOSCOW_TIME_ZONE, moscowIso } from '../schedule/times'
import type { UniversityScheduleProvider } from '../schedule/provider'
import { formatMoscowDate, moscowToday } from './window'
import type { FinishRunInput } from './repository'

/**
 * SyncEngine — идемпотентная безопасная синхронизация расписания
 * с Google Calendar (skill safe-calendar-sync).
 *
 * КРИТИЧЕСКОЕ ПРАВИЛО: неполный, пустой или ошибочный ответ университета
 * НИКОГДА не приводит к массовому удалению событий.
 */

/**
 * Хранилище, нужное движку. SyncRepository реализует этот интерфейс
 * структурно; в тестах используется in-memory подделка.
 */
export interface SyncEngineStore {
  createRunningRun(connectionId: number): Promise<{ runId: number }>
  finishRun(input: FinishRunInput): Promise<void>
  upsertSyncedEvent(input: {
    connectionId: number
    lesson: NormalizedLesson
    googleEventId: string
    payloadHashValue: string
  }): Promise<void>
  deleteSyncedEvent(connectionId: number, lessonKey: string): Promise<void>
  markConnectionRevoked(connectionId: number): Promise<void>
}

export interface SyncEngineDeps {
  provider: UniversityScheduleProvider
  /** Сервис календаря уже сконструирован с нужным tokenProvider. */
  calendar: GoogleCalendarService
  repository: SyncEngineStore
  connectionId: number
  calendarId: string
  now?: () => Date
  /** Темп запросов к Google (мс между операциями); 0 — в тестах. */
  paceMs?: number
}

interface ExistingIndexEntry {
  eventId: string
  storedPayloadHash: string | null
}

export class SyncEngine {
  private readonly now: () => Date

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async run(options: { confirmMassDeletion: boolean }): Promise<SyncReport> {
    const startedAt = this.now().toISOString()

    // Блокировка параллельных запусков: частичный unique index.
    // SyncLockedError пробрасывается наверх (API ответит 409).
    const run = await this.deps.repository.createRunningRun(this.deps.connectionId)

    return this.execute(run.runId, startedAt, options)
  }

  private async execute(
    runId: number,
    startedAt: string,
    options: { confirmMassDeletion: boolean },
  ): Promise<SyncReport> {
    const { repository, provider, calendar } = this.deps
    let createdCount = 0
    let updatedCount = 0
    let deletedCount = 0
    let unchangedCount = 0
    const errorDetails: string[] = []

    const finish = async (
      status: SyncReport['status'],
      message: string,
      massDeletionBlocked = false,
    ): Promise<SyncReport> => {
      const report: SyncReport = {
        runId,
        status,
        startedAt,
        finishedAt: this.now().toISOString(),
        createdCount,
        updatedCount,
        deletedCount,
        unchangedCount,
        errorCount: errorDetails.length,
        message,
        errorDetails: [...errorDetails],
        massDeletionBlocked,
      }
      await repository.finishRun({
        runId,
        status,
        createdCount,
        updatedCount,
        deletedCount,
        unchangedCount,
        errorCount: report.errorCount,
        errorDetails: report.errorDetails,
        message,
      })
      return report
    }

    const pace = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, this.deps.paceMs ?? 150))

    try {
      // 1. Расписание источника. Любая ошибка/невалидный ответ = стоп,
      //    события не трогаем.
      const schedule = await provider.fetchSchedule()

      // 2. Окно синхронизации: от сегодняшнего дня (Europe/Moscow) на месяц
      //    вперёд, но не дальше конца семестра.
      const today = moscowToday(this.now())
      const monthAhead = addDays(today, 29)
      const windowTo = schedule.group.dateTo < monthAhead ? schedule.group.dateTo : monthAhead
      if (today > windowTo) {
        return await finish(
          'success',
          'Семестр по данным университета завершён — синхронизировать нечего',
        )
      }

      const { lessons, filteredCount, filteredReasons } = normalizeSchedule(schedule, {
        window: { from: today, to: windowTo },
      })
      // Исключённые занятия — не ошибка: информация идёт в сообщение отчёта.
      const filteredNote = filteredCount > 0
        ? ` Исключено по правилам владельца: ${filteredCount}`
          + (filteredReasons.length ? ` (${filteredReasons.slice(0, 5).join('; ')})` : '')
        : ''

      // 3. Существующие помеченные события календаря в окне.
      const timeMin = moscowIso(today, '00:00')
      const timeMax = moscowIso(addDays(windowTo, 1), '00:00')
      const existingEvents = await calendar.listEvents(this.deps.calendarId, timeMin, timeMax)
      const index = indexByLessonKey(existingEvents)

      // 4. Пустой источник при наличии наших событий — полная остановка.
      if (lessons.length === 0 && index.size > 0) {
        return await finish(
          'error',
          'Источник вернул пустое расписание при наличии синхронизированных событий — изменения отменены',
        )
      }

      // 5. План операций.
      const normalizedKeys = new Set(lessons.map((lesson) => lesson.key))
      const toCreate: NormalizedLesson[] = []
      const toUpdate: NormalizedLesson[] = []

      for (const lesson of lessons) {
        const existing = index.get(lesson.key)
        if (!existing) {
          toCreate.push(lesson)
          continue
        }
        const hash = payloadHash(lesson)
        if (existing.storedPayloadHash && existing.storedPayloadHash === hash) {
          unchangedCount++
        } else {
          toUpdate.push(lesson)
        }
      }

      const deletions: { eventId: string; key: string }[] = []
      for (const [key, entry] of index) {
        if (!normalizedKeys.has(key)) deletions.push({ eventId: entry.eventId, key })
      }

      // 6. Защита от массового удаления.
      if (deletions.length > 0) {
        const ratio = deletions.length / Math.max(index.size, 1)
        if (ratio > MASS_DELETION_THRESHOLD && !options.confirmMassDeletion) {
          return await finish(
            'blocked',
            `План требует удаления ${deletions.length} из ${index.size} синхронизированных событий `
              + `(${Math.round(ratio * 100)}%). Это похоже на неполные данные источника. `
              + 'Подтвердите массовое удаление в интерфейсе, если это действительно ожидаемо.',
            true,
          )
        }
      }

      // 7. Применение операций (последовательно, с ограничением темпа).
      for (const lesson of toCreate) {
        try {
          const created = await calendar.insertEvent(this.deps.calendarId, eventPayload(lesson))
          await repository.upsertSyncedEvent({
            connectionId: this.deps.connectionId,
            lesson,
            googleEventId: created.id,
            payloadHashValue: payloadHash(lesson),
          })
          createdCount++
        } catch (error) {
          errorDetails.push(`Создание «${lesson.title}» ${lesson.date}: ${errorText(error)}`)
        }
        await pace()
      }

      for (const lesson of toUpdate) {
        try {
          const existing = index.get(lesson.key)
          if (!existing) continue
          await calendar.updateEvent(
            this.deps.calendarId,
            existing.eventId,
            eventPayload(lesson),
          )
          await repository.upsertSyncedEvent({
            connectionId: this.deps.connectionId,
            lesson,
            googleEventId: existing.eventId,
            payloadHashValue: payloadHash(lesson),
          })
          updatedCount++
        } catch (error) {
          errorDetails.push(`Обновление «${lesson.title}» ${lesson.date}: ${errorText(error)}`)
        }
        await pace()
      }

      for (const deletion of deletions) {
        try {
          await calendar.deleteEvent(this.deps.calendarId, deletion.eventId)
          await repository.deleteSyncedEvent(this.deps.connectionId, deletion.key)
          deletedCount++
        } catch (error) {
          // 404: событие уже удалено в Google — это не ошибка удаления.
          if (error instanceof GoogleCalendarError && error.status === 404) {
            await repository.deleteSyncedEvent(this.deps.connectionId, deletion.key)
            deletedCount++
            continue
          }
          errorDetails.push(`Удаление события ${deletion.key}: ${errorText(error)}`)
        }
        await pace()
      }

      // 8. Итог.
      const status: SyncReport['status'] = errorDetails.length > 0 ? 'error' : 'success'
      const message = errorDetails.length > 0
        ? `Синхронизация завершена с ошибками: создано ${createdCount}, обновлено ${updatedCount}, `
          + `удалено ${deletedCount}, без изменений ${unchangedCount}, ошибок ${errorDetails.length}.`
        : `Синхронизация завершена: создано ${createdCount}, обновлено ${updatedCount}, `
          + `удалено ${deletedCount}, без изменений ${unchangedCount}.${filteredNote}`
      return await finish(status, message)
    } catch (error) {
      if (error instanceof CalendarAccessRevokedError) {
        await repository.markConnectionRevoked(this.deps.connectionId)
        return await finish(
          'error',
          'Доступ к Google Calendar отозван. Подключите аккаунт заново.',
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      errorDetails.push(message)
      return await finish('error', `Синхронизация не выполнена: ${message}`)
    }
  }
}

/** Индекс существующих помеченных событий по unicalendarKey. */
export function indexByLessonKey(events: CalendarEvent[]): Map<string, ExistingIndexEntry> {
  const map = new Map<string, ExistingIndexEntry>()
  for (const event of events) {
    if (!event.id) continue
    const key = event.extendedProperties?.private?.unicalendarKey
    if (!key) continue
    map.set(key, {
      eventId: event.id,
      storedPayloadHash: event.extendedProperties?.private?.payloadHash ?? null,
    })
  }
  return map
}

/** Payload события Google из нормализованного занятия. */
export function eventPayload(lesson: NormalizedLesson): GoogleEventPayload {
  const ourProperties: Record<string, string> = {
    unicalendarKey: lesson.key,
    unicalendarApp: '1',
    payloadHash: payloadHash(lesson),
  }
  return {
    summary: lesson.title,
    description: lesson.description,
    location: lesson.location,
    start: { dateTime: lesson.startsAt, timeZone: MOSCOW_TIME_ZONE },
    end: { dateTime: lesson.endsAt, timeZone: MOSCOW_TIME_ZONE },
    extendedProperties: { private: ourProperties },
    reminders: { useDefault: true },
  }
}

function errorText(error: unknown): string {
  if (error instanceof GoogleCalendarError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

function addDays(date: string, days: number): string {
  return formatMoscowDate(new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)) + days,
    ),
  ))
}
