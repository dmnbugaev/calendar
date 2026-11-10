import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RawSchedule } from '#shared/types/sync'
import { SyncEngine } from '../../server/services/sync/engine'
import {
  FakeCalendar,
  FakeStore,
  buildRawSchedule,
  gridLesson,
  gridSlot,
  normalizeWindow,
} from './helpers'
import { GoogleCalendarError } from '../../server/services/google/calendar'
import { ScheduleProviderError } from '../../server/services/schedule/provider'
import { parseScheduleResponse } from '../../server/services/schedule/parser'
import { payloadHash } from '../../server/services/schedule/normalizer'

/**
 * 13 обязательных сценариев синхронизации (задание, раздел 10).
 * Все зависимости — подделки; Google и БД не задействованы.
 */

const CONNECTION_ID = 1
const CALENDAR_ID = 'cal-test'

function buildEngine(schedule: RawSchedule, calendar: FakeCalendar, store: FakeStore) {
  const provider = {
    fetchSchedule: async () => schedule,
  } as unknown as import('../../server/services/schedule/provider').UniversityScheduleProvider

  const engine = new SyncEngine({
    provider,
    calendar: calendar.asService(),
    repository: store,
    connectionId: CONNECTION_ID,
    calendarId: CALENDAR_ID,
    now: () => new Date('2026-11-10T12:00:00+03:00'),
    paceMs: 0,
  })
  return engine
}


describe('SyncEngine', () => {
  it('1. первая синхронизация — создаёт все события', async () => {
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, location: 'А-234' }),
      gridLesson({ day: 3, slot: 1, subject: 'Проектная деятельность', location: 'ПД' }),
    ]) })
    const calendar = new FakeCalendar()
    const store = new FakeStore()

    const report = await buildEngine(schedule, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('success')
    expect(report.createdCount).toBe(2)
    expect(report.updatedCount).toBe(0)
    expect(report.deletedCount).toBe(0)
    expect(calendar.events.size).toBe(2)
    expect(store.events.size).toBe(2)
    for (const event of calendar.events.values()) {
      expect(event.event.extendedProperties?.private?.unicalendarApp).toBe('1')
      expect(event.event.extendedProperties?.private?.unicalendarKey).toBeTruthy()
      expect(event.event.extendedProperties?.private?.payloadHash).toBeTruthy()
    }
  })

  it('2. повторная синхронизация неизменённых данных — zero diff', async () => {
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, location: 'А-234' }),
    ]) })
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    const engine = buildEngine(schedule, calendar, store)

    const first = await engine.run({ confirmMassDeletion: false })
    expect(first.createdCount).toBe(1)

    const second = await engine.run({ confirmMassDeletion: false })
    expect(second.status).toBe('success')
    expect(second.createdCount).toBe(0)
    expect(second.updatedCount).toBe(0)
    expect(second.deletedCount).toBe(0)
    expect(second.unchangedCount).toBe(1)
    expect(calendar.calls.insert).toBe(1)
    expect(calendar.calls.update).toBe(0)
    expect(calendar.calls.delete).toBe(0)
  })

  it('3. изменение аудитории — обновление без создания нового события', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    const before = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, location: 'А-234' }),
    ]) })
    const engine = buildEngine(before, calendar, store)
    await engine.run({ confirmMassDeletion: false })
    const originalEventId = [...calendar.events.keys()][0]!

    const after = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, location: 'Г-301' }),
    ]) })
    const report = await buildEngine(after, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('success')
    expect(report.updatedCount).toBe(1)
    expect(report.createdCount).toBe(0)
    expect(report.deletedCount).toBe(0)
    expect(calendar.calls.insert).toBe(1) // только первичная вставка
    expect([...calendar.events.keys()]).toEqual([originalEventId])
    expect(calendar.events.get(originalEventId)!.event.location).toBe('Г-301')
  })

  it('4. изменение преподавателя — обновление события', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    const after = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, teacher: 'Змазнева Олеся Анатольевна' }),
    ]) })
    const report = await buildEngine(after, calendar, store).run({ confirmMassDeletion: false })

    expect(report.updatedCount).toBe(1)
    expect(report.deletedCount).toBe(0)
    const event = [...calendar.events.values()][0]!
    expect(event.event.description).toContain('Змазнева Олеся Анатольевна')
  })

  it('5. перенос занятия (смена времени) — старое удалено, новое создано', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([
        gridLesson({ day: 2, slot: 2 }),
        gridLesson({ day: 3, slot: 1, subject: 'Стабильное занятие' }),
      ]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    // Первое занятие переместилось на другую пару.
    const after = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 3 }),
      gridLesson({ day: 3, slot: 1, subject: 'Стабильное занятие' }),
    ]) })
    const report = await buildEngine(after, calendar, store).run({ confirmMassDeletion: false })

    expect(report.deletedCount).toBe(1)
    expect(report.createdCount).toBe(1)
    expect(calendar.events.size).toBe(2)
    const moved = [...calendar.events.values()].find(
      (e) => e.event.summary!.includes('Основы веб-технологий'),
    )!
    // Пара 3 = 12:20-13:50 при evening=0
    expect(moved.event.start!.dateTime).toContain('T12:20:00')
  })

  it('6. отмена занятия (исчезло из источника) — событие удалено', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([
        gridLesson({ day: 2, slot: 2 }),
        gridLesson({ day: 4, slot: 3, subject: 'Инженерная коммуникация' }),
      ]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })
    expect(calendar.events.size).toBe(2)

    // Осталось только одно занятие — второе отменено.
    const after = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2 }),
    ]) })
    const report = await buildEngine(after, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('success')
    expect(report.deletedCount).toBe(1)
    expect(calendar.events.size).toBe(1)
  })

  it('7. недоступность сайта университета — ничего не трогаем', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })
    const listCallsAfterSetup = calendar.calls.list

    const failingProvider = {
      fetchSchedule: async () => {
        throw new ScheduleProviderError('Источник вернул HTTP 500')
      },
    } as unknown as import('../../server/services/schedule/provider').UniversityScheduleProvider

    const engine = new SyncEngine({
      provider: failingProvider,
      calendar: calendar.asService(),
      repository: store,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      now: () => new Date('2026-11-10T12:00:00+03:00'),
      paceMs: 0,
    })

    const report = await engine.run({ confirmMassDeletion: false })
    expect(report.status).toBe('error')
    expect(report.createdCount + report.updatedCount + report.deletedCount).toBe(0)
    expect(calendar.events.size).toBe(1)
    expect(calendar.calls.list).toBe(listCallsAfterSetup) // до календаря дело не дошло
  })

  it('8. пустой ответ источника при наличии событий — остановка без удалений', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    // Пустой grid (частичный/пустой ответ).
    const empty = buildRawSchedule({ grid: {} })
    const report = await buildEngine(empty, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('error')
    expect(report.deletedCount).toBe(0)
    expect(calendar.events.size).toBe(1)
  })

  it('8b. частичный ответ (массовое исчезновение) — блокировка, а не удаление', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    // 4 занятия во вторник–пятницу (дни 2–5).
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([
        gridLesson({ day: 2, slot: 1 }),
        gridLesson({ day: 3, slot: 2 }),
        gridLesson({ day: 4, slot: 3 }),
        gridLesson({ day: 5, slot: 4 }),
      ]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    // Осталось 1 из 4 (75% удалений) — порог 50% превышен.
    const partial = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 1 }),
    ]) })
    const report = await buildEngine(partial, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('blocked')
    expect(report.massDeletionBlocked).toBe(true)
    expect(calendar.events.size).toBe(4)
  })

  it('8c. подтверждённое массовое удаление выполняется', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    await buildEngine(
      buildRawSchedule({ grid: gridSlot([
        gridLesson({ day: 2, slot: 1 }),
        gridLesson({ day: 3, slot: 2 }),
        gridLesson({ day: 4, slot: 3 }),
      ]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    const partial = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 1 })]) })
    const report = await buildEngine(partial, calendar, store)
      .run({ confirmMassDeletion: true })

    expect(report.status).toBe('success')
    expect(report.deletedCount).toBe(2)
    expect(calendar.events.size).toBe(1)
  })

  it('9. ошибки Google Calendar API — фиксируются, остальные события обрабатываются', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 1, subject: 'Первое занятие' }),
      gridLesson({ day: 2, slot: 2, subject: 'Второе занятие' }),
    ]) })
    calendar.failNext('insert', new GoogleCalendarError('HTTP 500 (backendError)', 500, 'backendError'))

    const report = await buildEngine(schedule, calendar, store).run({ confirmMassDeletion: false })

    expect(report.status).toBe('error')
    expect(report.errorCount).toBe(1)
    expect(report.createdCount).toBe(1)
    expect(calendar.events.size).toBe(1)
  })

  it('10. истечение токена — обновление и повтор запроса', async () => {
    const schedule = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) })
    const calendar = new FakeCalendar()
    const store = new FakeStore()

    let refreshCount = 0
    let firstGetToken = true
    const provider = {
      fetchSchedule: async () => schedule,
    } as unknown as import('../../server/services/schedule/provider').UniversityScheduleProvider

    // ВАЖНО: переопределяем fetch ДО asService() — сервис привязывает его
    // в конструкторе. Первый listEvents возвращает 401, CalendarService
    // обязан вызвать refresh() и повторить запрос.
    const originalFetch = calendar.fetch.bind(calendar)
    calendar.fetch = async (url, init) => {
      const response = await originalFetch(url, init)
      if (response.ok && calendar.events.size === 0 && calendar.calls.list === 1) {
        return new Response(JSON.stringify({ error: { errors: [{ reason: 'unauthorized' }] } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return response
    }

    const engine = new SyncEngine({
      provider,
      calendar: calendar.asService({
        getToken: async () => {
          if (firstGetToken) {
            firstGetToken = false
            return 'expired-token'
          }
          return 'fresh-token'
        },
        refresh: async () => {
          refreshCount++
          return 'fresh-token'
        },
      }),
      repository: store,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      now: () => new Date('2026-11-10T12:00:00+03:00'),
      paceMs: 0,
    })

    const report = await engine.run({ confirmMassDeletion: false })
    expect(refreshCount).toBe(1)
    expect(report.status).toBe('success')
    expect(report.createdCount).toBe(1)
  })

  it('11. параллельные запуски — второй отклоняется', async () => {
    const schedule = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) })
    const calendar = new FakeCalendar()
    const store = new FakeStore()

    // Первый запуск:
    await buildEngine(schedule, calendar, store).run({ confirmMassDeletion: false })

    // Имитация: второй запуск приходит, пока running-запуск существует.
    store.hasRunningRun = true
    await expect(
      buildEngine(schedule, calendar, store).run({ confirmMassDeletion: false }),
    ).rejects.toThrow(/sync_history_one_running_uq/)
    store.hasRunningRun = false
  })

  it('12. дубликаты невозможны: два занятия в одном слоте получают разные ключи', async () => {
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, subject: 'Проектная деятельность', location: 'ПД' }),
      gridLesson({ day: 2, slot: 2, subject: 'Проектная деятельность', location: 'ПД2' }),
    ]) })
    const calendar = new FakeCalendar()
    const store = new FakeStore()

    const report = await buildEngine(schedule, calendar, store).run({ confirmMassDeletion: false })
    expect(report.createdCount).toBe(2)
    const keys = new Set(store.events.keys())
    expect(keys.size).toBe(2)
  })

  it('13. посторонние события (без нашего маркера) не удаляются', async () => {
    const calendar = new FakeCalendar()
    const store = new FakeStore()
    // Сначала создаём «постороннее» событие напрямую через календарь.
    const foreignService = calendar.asService()
    await foreignService.insertEvent(CALENDAR_ID, {
      summary: 'Личное событие пользователя',
      description: 'Создано вручную',
      location: null,
      start: { dateTime: '2026-11-12T18:00:00+03:00', timeZone: 'Europe/Moscow' },
      end: { dateTime: '2026-11-12T19:00:00+03:00', timeZone: 'Europe/Moscow' },
      extendedProperties: { private: {} },
      reminders: { useDefault: true },
    })
    expect(calendar.events.size).toBe(1)

    const report = await buildEngine(
      buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) }),
      calendar,
      store,
    ).run({ confirmMassDeletion: false })

    expect(report.status).toBe('success')
    expect(report.deletedCount).toBe(0)
    const summaries = [...calendar.events.values()].map((e) => e.event.summary)
    expect(summaries).toContain('Личное событие пользователя')
  })
})

describe('Парсер ответа источника (fixture)', () => {
  it('валидный fixture проходит', () => {
    const fixture = JSON.parse(
      readFileSync('fixtures/rasp-group-251-362.json', 'utf8'),
    )
    const parsed = parseScheduleResponse(fixture)
    expect(parsed.group.title).toBe('251-362')
  })

  it('ошибка источника → ScheduleParseError', () => {
    expect(() => parseScheduleResponse({ status: 'error', message: 'Еще не готово расписание для группы' }))
      .toThrow(/Еще не готово/)
  })

  it('изменённая структура → ошибка валидации', () => {
    expect(() => parseScheduleResponse({ status: 'ok', isSession: false, grid: {}, group: {} }))
      .toThrow()
  })

  it('session-режим не поддерживается', () => {
    const fixture = { status: 'ok', isSession: true, grid: {}, group: { title: '251-362', course: 2, dateFrom: '2026-09-01', dateTo: '2026-12-31', evening: 0, comment: null } }
    expect(() => parseScheduleResponse(fixture)).toThrow(/session/)
  })
})

describe('Нормализатор', () => {
  it('занятие разворачивается на конкретные даты в московском времени', () => {
    const schedule = buildRawSchedule({
      grid: gridSlot([gridLesson({ day: 2, slot: 2, df: '2026-11-01', dt: '2026-11-20' })]),
    })
    const lessons = normalizeWindow(schedule, '2026-11-10', '2026-11-17')
    // 2026-11-10 — вторник; вторники в окне: 10 и 17.
    expect(lessons.length).toBe(2)
    expect(lessons[0]!.date).toBe('2026-11-10')
    expect(lessons[0]!.startsAt).toBe('2026-11-10T10:40:00+03:00')
    expect(lessons[0]!.endsAt).toBe('2026-11-10T12:10:00+03:00')
  })

  it('ключ занятия стабилен, payloadHash меняется при смене аудитории', () => {
    const schedule1 = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2, location: 'А-234' })]) })
    const schedule2 = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2, location: 'Г-301' })]) })
    const lessons1 = normalizeWindow(schedule1, '2026-11-10', '2026-11-10')
    const lessons2 = normalizeWindow(schedule2, '2026-11-10', '2026-11-10')
    expect(lessons1[0]!.key).toBe(lessons2[0]!.key)
    expect(payloadHash(lessons1[0]!)).not.toBe(payloadHash(lessons2[0]!))
  })

  it('HTML в аудиториях превращается в чистый текст и ссылку', () => {
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, location: '<a href="https://webinar.example/join" target="_blank">📷 Webinar</a>' }),
    ]) })
    const lessons = normalizeWindow(schedule, '2026-11-10', '2026-11-10')
    expect(lessons[0]!.location).toBe('📷 Webinar')
    expect(lessons[0]!.url).toBe('https://webinar.example/join')
  })

  it('аудитория формата «А-234» распознаётся как корпус и аудитория', () => {
    const schedule = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2, location: 'А-234' })]) })
    const lessons = normalizeWindow(schedule, '2026-11-10', '2026-11-10')
    expect(lessons[0]!.building).toBe('А')
    expect(lessons[0]!.room).toBe('А-234')
  })

  it('описание события содержит группу и ссылку на расписание', () => {
    const schedule = buildRawSchedule({ grid: gridSlot([gridLesson({ day: 2, slot: 2 })]) })
    const lessons = normalizeWindow(schedule, '2026-11-10', '2026-11-10')
    expect(lessons[0]!.description).toContain('Учебная группа: 251-362')
    expect(lessons[0]!.description).toContain('https://rasp.dmami.ru/?g=251-362')
  })
})
