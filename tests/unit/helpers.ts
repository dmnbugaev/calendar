import type { NormalizedLesson, RawSchedule, RawScheduleLesson } from '#shared/types/sync'
import type { CalendarEvent, GoogleEventPayload } from '../../server/services/google/calendar'
import { GoogleCalendarService } from '../../server/services/google/calendar'
import type { SyncEngineStore } from '../../server/services/sync/engine'
import type { FinishRunInput } from '../../server/services/sync/repository'
import { normalizeSchedule } from '../../server/services/schedule/normalizer'

/**
 * Подделки для тестов SyncEngine: provider, calendar, store.
 */

export interface FakeLessonOptions {
  subject?: string
  teacher?: string
  location?: string
  type?: string | null
  day?: number
  slot?: number
  df?: string
  dt?: string
}

/** Сборка валидного RawSchedule по образцу реального fixture. */
export function buildRawSchedule(options: {
  dateFrom?: string
  dateTo?: string
  evening?: 0 | 1 | 2
  grid?: Record<string, Record<string, object[]>>
}): RawSchedule {
  return {
    status: 'ok',
    isSession: false,
    group: {
      title: '251-362',
      course: 2,
      dateFrom: options.dateFrom ?? '2026-09-01',
      dateTo: options.dateTo ?? '2026-12-31',
      evening: options.evening ?? 0,
      comment: null,
    },
    grid: options.grid ?? {},
  }
}

/** Создать занятие-слот в сетке. */
export function gridSlot(lessons: object[]): Record<string, object[]> {
  const grid: Record<string, Record<string, object[]>> = {}
  for (const lesson of lessons) {
    const l = lesson as FakeLessonOptions & { day: number; slot: number }
    const day = String(l.day ?? 2)
    const slot = String(l.slot ?? 2)
    grid[day] = grid[day] ?? {}
    grid[day][slot] = grid[day][slot] ?? []
    grid[day][slot].push(lesson)
  }
  return grid
}

export function gridLesson(
  options: FakeLessonOptions & { day: number; slot: number },
): RawScheduleLesson & { day: number; slot: number } {
  return {
    // day/slot — тестовые метки, gridSlot читает их из объекта.
    day: options.day,
    slot: options.slot,
    sbj: options.subject ?? 'Основы веб-технологий',
    teacher: options.teacher ?? 'Речинский Владислав Алексеевич',
    teachers: options.teacher ? [{ id: 1, name: options.teacher }] : [],
    dts: '10 Ноя - 14 Ноя',
    // По умолчанию одна неделя — занятия появляются ровно один раз.
    df: options.df ?? '2026-11-10',
    dt: options.dt ?? '2026-11-14',
    auditories: options.location
      ? [{ title: options.location, color: '#00F' }]
      : [],
    shortRooms: [],
    location: options.location ?? '',
    type: options.type === undefined ? 'Лекция' : options.type,
    week: '',
    align: 'left',
    e_link: null,
  }
}

/** Нормализованные занятия расписания в окне (без учёта счётчика фильтров). */
export function normalizeWindow(schedule: RawSchedule, from: string, to: string): NormalizedLesson[] {
  return normalizeSchedule(schedule, { window: { from, to } }).lessons
}

// -------------------------------------------------------------------

/** Подделка GoogleCalendarService: хранит события в памяти. */
export class FakeCalendar {
  events = new Map<string, { payload: GoogleEventPayload; event: CalendarEvent }>()
  /** Очередь ошибок по типу операции: insert/update/delete/list. */
  errorQueue: { op: string; error: unknown }[] = []
  /** Счётчики вызовов. */
  calls: { insert: number; update: number; delete: number; list: number } = {
    insert: 0,
    update: 0,
    delete: 0,
    list: 0,
  }
  private idCounter = 1
  private nextError: string | null = null

  /** Сервис календаря с общим tokenProvider (или пустышкой). */
  asService(tokenProvider?: { getToken: () => Promise<string>; refresh: () => Promise<string> }): GoogleCalendarService {
    return new GoogleCalendarService(
      tokenProvider ?? { getToken: async () => 'token', refresh: async () => 'token' },
      this.fetch.bind(this),
      async () => {},
    )
  }

  /** Пометить следующую операцию ошибкой Google. */
  failNext(op: string, error: unknown): void {
    this.errorQueue.push({ op, error })
    this.nextError = op
  }

  private takeError(op: string): unknown | null {
    if (this.nextError !== op) return null
    this.nextError = null
    const entry = this.errorQueue.find((e) => e.op === op)
    return entry?.error ?? null
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const path = new URL(url).pathname
    const method = init?.method ?? 'GET'

    if (method === 'GET' && path.includes('/events')) {
      this.calls.list++
      const error = this.takeError('list')
      if (error) throw error
      const events = [...this.events.values()].map((e) => e.event)
      const body = { items: events }
      return json(body)
    }

    if (method === 'POST' && path.includes('/events')) {
      this.calls.insert++
      const error = this.takeError('insert')
      if (error) throw error
      const payload = JSON.parse(init!.body as string) as GoogleEventPayload
      const id = `google-event-${this.idCounter++}`
      const event = toEvent(id, payload)
      this.events.set(id, { payload, event })
      return json(event)
    }

    if (method === 'PUT' && path.includes('/events/')) {
      this.calls.update++
      const error = this.takeError('update')
      if (error) throw error
      const id = path.split('/').pop()!
      const payload = JSON.parse(init!.body as string) as GoogleEventPayload
      const event = toEvent(id, payload)
      if (!this.events.has(id)) {
        return json({}, { status: 404, statusText: 'Not Found' })
      }
      this.events.set(id, { payload, event })
      return json(event)
    }

    if (method === 'DELETE' && path.includes('/events/')) {
      this.calls.delete++
      const error = this.takeError('delete')
      if (error) throw error
      const id = path.split('/').pop()!
      if (!this.events.has(id)) {
        return json({}, { status: 404, statusText: 'Not Found' })
      }
      this.events.delete(id)
      return new Response(null, { status: 204 })
    }

    return json({}, { status: 404, statusText: 'Unknown path' })
  }
}

function toEvent(id: string, payload: GoogleEventPayload): CalendarEvent {
  return {
    id,
    summary: payload.summary,
    description: payload.description,
    location: payload.location,
    start: payload.start,
    end: payload.end,
    extendedProperties: { private: { ...payload.extendedProperties.private } },
  }
}

function json(body: unknown, init?: { status: number; statusText: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

// -------------------------------------------------------------------

class StoreError extends Error {}

/** In-memory реализация SyncEngineStore. */
export class FakeStore implements SyncEngineStore {
  runs: { runId: number; finished: FinishRunInput | null }[] = []
  events = new Map<string, { googleEventId: string; payloadHash: string }>()
  private idCounter = 1
  /** Имитация активного running-запуска (для проверки блокировки). */
  hasRunningRun = false
  revoked = false

  async createRunningRun(_connectionId: number): Promise<{ runId: number }> {
    if (this.hasRunningRun) {
      const error = new StoreError('duplicate key value violates unique constraint "sync_history_one_running_uq"')
      throw error
    }
    this.hasRunningRun = true
    const runId = this.idCounter++
    this.runs.push({ runId, finished: null })
    return { runId }
  }

  async finishRun(input: FinishRunInput): Promise<void> {
    this.hasRunningRun = false
    const run = this.runs.find((r) => r.runId === input.runId)
    if (run) run.finished = input
  }

  async upsertSyncedEvent(input: {
    connectionId: number
    lesson: NormalizedLesson
    googleEventId: string
    payloadHashValue: string
  }): Promise<void> {
    this.events.set(input.lesson.key, {
      googleEventId: input.googleEventId,
      payloadHash: input.payloadHashValue,
    })
  }

  async deleteSyncedEvent(_connectionId: number, lessonKey: string): Promise<void> {
    this.events.delete(lessonKey)
  }

  async markConnectionRevoked(_connectionId: number): Promise<void> {
    this.revoked = true
  }
}

export { StoreError }
