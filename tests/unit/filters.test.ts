import { describe, expect, it } from 'vitest'
import type { RawSchedule } from '#shared/types/sync'
import { checkLessonExclusion } from '../../server/services/schedule/filters'
import { normalizeSchedule } from '../../server/services/schedule/normalizer'
import { buildRawSchedule, gridLesson, gridSlot } from './helpers'

/**
 * Правила исключения владельца: физическая подготовка (спортзал),
 * проектная деятельность, онлайн-занятия Webinar; и фильтрация
 * по периоду курса (df/dt — курс ещё не начался / уже закончился).
 */

describe('Фильтры предметов', () => {
  it('физическая подготовка исключается', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'Общая физическая подготовка (см. график кафедры)', location: 'Спортзал' })
    expect(checkLessonExclusion(lesson)).toEqual({ excluded: true, reason: expect.stringContaining('исключений') })
  })

  it('физическая культура (другая формулировка) исключается', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'Элективные дисциплины по физической культуре' })
    expect(checkLessonExclusion(lesson).excluded).toBe(true)
  })

  it('проектная деятельность исключается', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'Проектная деятельность', location: 'ПД' })
    expect(checkLessonExclusion(lesson).excluded).toBe(true)
  })

  it('обычный предмет не исключается', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'Основы веб-технологий', location: 'А-234' })
    expect(checkLessonExclusion(lesson)).toEqual({ excluded: false })
  })

  it('webinar в месте проведения исключает занятие', () => {
    const lesson = gridLesson({
      day: 2,
      slot: 2,
      subject: 'Математическая логика',
      location: '<a href="https://my.mts-link.ru/j/x" target="_blank">📷 Webinar</a>',
    })
    expect(checkLessonExclusion(lesson).excluded).toBe(true)
  })

  it('webinar регистронезависим', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'X', location: 'WEBINAR' })
    expect(checkLessonExclusion(lesson).excluded).toBe(true)
  })

  it('офлайн-аудитория не исключает занятие', () => {
    const lesson = gridLesson({ day: 2, slot: 2, subject: 'Проектирование баз данных', location: 'В-502' })
    expect(checkLessonExclusion(lesson)).toEqual({ excluded: false })
  })
})

function normalizeResult(schedule: RawSchedule, from: string, to: string) {
  return normalizeSchedule(schedule, { window: { from, to } })
}

describe('Фильтры в нормализаторе', () => {
  it('отфильтрованные занятия не попадают в результат, счётчик учитывает их', () => {
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, subject: 'Основы веб-технологий', location: 'А-234' }),
      gridLesson({ day: 2, slot: 3, subject: 'Общая физическая подготовка', location: 'Спортзал' }),
      gridLesson({ day: 3, slot: 2, subject: 'Проектная деятельность', location: 'ПД' }),
    ]) })

    const result = normalizeResult(schedule, '2026-11-10', '2026-11-10')
    expect(result.lessons.map((l) => l.subject)).toEqual(['Основы веб-технологий'])
    expect(result.filteredCount).toBe(2)
    expect(result.filteredReasons.length).toBe(2)
  })

  it('курс ещё не начался — занятия не попадают в окно', () => {
    // df/dt в декабре, окно — ноябрь.
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, df: '2026-12-01', dt: '2026-12-31' }),
    ]) })
    const result = normalizeResult(schedule, '2026-11-10', '2026-11-20')
    expect(result.lessons).toHaveLength(0)
  })

  it('курс уже закончился — занятия не попадают в окно', () => {
    // df/dt в сентябре–октябре, окно — ноябрь.
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, df: '2026-09-01', dt: '2026-10-31' }),
    ]) })
    const result = normalizeResult(schedule, '2026-11-10', '2026-11-20')
    expect(result.lessons).toHaveLength(0)
  })

  it('активный курс даёт занятия только внутри своего периода', () => {
    // Курс 12–18 ноября: из вторников окна (10, 17, 24) в период попадает только 17-е.
    const schedule = buildRawSchedule({ grid: gridSlot([
      gridLesson({ day: 2, slot: 2, df: '2026-11-12', dt: '2026-11-18' }),
    ]) })
    const result = normalizeResult(schedule, '2026-11-10', '2026-11-24')
    expect(result.lessons.map((l) => l.date)).toEqual(['2026-11-17'])
  })
})
