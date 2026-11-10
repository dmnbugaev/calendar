import { createHash } from 'node:crypto'
import type { NormalizedLesson, RawSchedule, RawScheduleLesson, WeekParity } from '#shared/types/sync'
import { checkLessonExclusion } from './filters'
import { stripHtml } from './html'
import { MOSCOW_TIME_ZONE, moscowIso, pairTimes } from './times'
import { SCHEDULE_PAGE_URL } from './provider'

/**
 * ScheduleNormalizer — разворачивает grid расписания в конкретные занятия:
 * диапазоны df/dt → календарные даты, чётность недель → фильтр дат,
 * слоты → московское время, аудитории с HTML → чистые поля.
 */

export class ScheduleNormalizerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleNormalizerError'
  }
}

/** Окно нормализации (включительно), даты YYYY-MM-DD. */
export interface NormalizeWindow {
  from: string
  to: string
}

export interface NormalizeOptions {
  window: NormalizeWindow
  /** Часовой пояс события — фиксирован Europe/Moscow. */
  timeZone?: string
}

/** Какая доля помеченных событий может быть удалена без подтверждения. */
export const MASS_DELETION_THRESHOLD = 0.5

const WEEKDAY_MON = 1

/**
 * Привязка чётности недель. Правило (документированное допущение, см.
 * fixtures/RESEARCH.md): учебные недели считаются от начала семестра
 * (group.dateFrom); неделя, содержащая дату начала семестра, — первая,
 * она же «нечётная». Первая неделя считается с понедельника той недели,
 * в которую попадает dateFrom.
 */
export function weekParityOfDate(date: string, semesterStart: string): WeekParity {
  const weekStart = startOfISOWeekMs(parseUtcDate(date))
  const semesterWeekStart = startOfISOWeekMs(parseUtcDate(semesterStart))
  const weekIndex = Math.round((weekStart - semesterWeekStart) / (7 * 86_400_000))
  // Нечётные индексы недель: 0, 2, 4... — нет: первая учебная неделя (индекс 0)
  // — «нечётная» по российской конвенции, поэтому чётность чередуется от 0.
  return weekIndex % 2 === 0 ? 'odd' : 'even'
}

/** Стабильный ключ занятия: hash(группа | дата | время | дисциплина | индекс). */
export function lessonKey(
  group: string,
  lesson: {
    date: string
    startsAt: string
    endsAt: string
    subject: string
  },
  slotIndex: number,
): string {
  const raw = [
    group,
    lesson.date,
    lesson.startsAt,
    lesson.endsAt,
    lesson.subject,
    `#${slotIndex}`,
  ].join('|')
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32)
}

/** Хеш payload события — по нему решаем, нужно ли обновлять событие. */
export function payloadHash(lesson: NormalizedLesson): string {
  const canonical = JSON.stringify({
    title: lesson.title,
    description: lesson.description,
    location: lesson.location ?? '',
    startsAt: lesson.startsAt,
    endsAt: lesson.endsAt,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)
}

/** Результат нормализации: занятия + число исключённых по правилам владельца. */
export interface NormalizeResult {
  lessons: NormalizedLesson[]
  /** Сколько занятий (слотов, не дат) исключено фильтрами (физра, ПД, Webinar). */
  filteredCount: number
  /** Причины исключений (по одному на занятие, первые 20). */
  filteredReasons: string[]
}

export function normalizeSchedule(
  schedule: RawSchedule,
  options: NormalizeOptions,
): NormalizeResult {
  const { from, to } = options.window
  if (from > to) {
    throw new ScheduleNormalizerError('Некорректное окно нормализации')
  }

  const group = schedule.group.title
  const lessons: NormalizedLesson[] = []
  const filteredReasons: string[] = []
  let filteredCount = 0

  for (const [dayKey, slots] of Object.entries(schedule.grid)) {
    const weekday = Number(dayKey)
    for (const [slotKey, slotLessons] of Object.entries(slots)) {
      if (!slotLessons.length) continue
      const pairNumber = Number(slotKey)
      const times = pairTimes(schedule.group.evening, pairNumber)
      if (!times) {
        throw new ScheduleNormalizerError(
          `Неизвестный номер пары ${pairNumber} для evening=${schedule.group.evening}`,
        )
      }
      const [start, end] = times

      // Детерминированный порядок занятий в слоте (подгруппы) — иначе
      // стабильность ключей не гарантирована.
      const sorted = [...slotLessons].sort((a, b) =>
        (a.sbj + '|' + a.teacher + '|' + a.location + '|' + (a.type ?? '')).localeCompare(
          b.sbj + '|' + b.teacher + '|' + b.location + '|' + (b.type ?? ''),
          'ru',
        ),
      )

      sorted.forEach((lesson, slotIndex) => {
        // Правила исключения владельца (до разворота дат).
        const exclusion = checkLessonExclusion(lesson)
        if (exclusion.excluded) {
          filteredCount++
          if (filteredReasons.length < 20) filteredReasons.push(exclusion.reason)
          return
        }

        const dates = lessonDates(lesson.df, lesson.dt, weekday, {
          from,
          to,
          semesterStart: schedule.group.dateFrom,
          week: parseWeekFlag(lesson.week),
        })

        for (const date of dates) {
          lessons.push(buildLesson(lesson, {
            group,
            date,
            start,
            end,
            slotIndex,
          }))
        }
      })
    }
  }

  lessons.sort((a, b) => (a.startsAt + a.key).localeCompare(b.startsAt + b.key))
  return { lessons, filteredCount, filteredReasons }
}

interface BuildLessonInput {
  group: string
  date: string
  start: string
  end: string
  slotIndex: number
}

function buildLesson(
  lesson: RawScheduleLesson,
  input: BuildLessonInput,
): NormalizedLesson {
  const auditory = extractAuditoryInfo(lesson)
  const teacher = lesson.teacher || lesson.teachers.map((t) => t.name).join(', ')
  const title = lesson.type ? `${lesson.sbj} — ${lesson.type}` : lesson.sbj

  const descriptionLines: string[] = []
  if (teacher) descriptionLines.push(`Преподаватель: ${teacher}`)
  if (lesson.type) descriptionLines.push(`Тип занятия: ${lesson.type}`)
  descriptionLines.push(`Учебная группа: ${input.group}`)
  if (auditory.building) descriptionLines.push(`Корпус: ${auditory.building}`)
  if (auditory.room) descriptionLines.push(`Аудитория: ${auditory.room}`)
  descriptionLines.push(`Расписание: ${SCHEDULE_PAGE_URL}`)
  const lessonUrl = lesson.e_link ?? auditory.url
  if (lessonUrl) descriptionLines.push(`Ссылка на занятие: ${lessonUrl}`)

  const startsAt = moscowIso(input.date, input.start)
  const endsAt = moscowIso(input.date, input.end)

  const normalized: NormalizedLesson = {
    key: '',
    date: input.date,
    startsAt,
    endsAt,
    subject: lesson.sbj,
    lessonType: lesson.type,
    teacher,
    location: auditory.location ?? '',
    building: auditory.building,
    room: auditory.room,
    url: lessonUrl,
    title,
    description: descriptionLines.join('\n'),
  }
  normalized.key = lessonKey(input.group, normalized, input.slotIndex)
  return normalized
}

interface AuditoryInfo {
  location: string | null
  building: string | null
  room: string | null
  url: string | null
}

const ROOM_PATTERN = /^([А-ЯЁA-Z])\s?[-–]?\s?(\d{2,4}[а-яёA-Z]{0,3})$/u

/**
 * Разбор поля auditories: title может содержать HTML
 * («<a href="...">📷 Webinar</a>»). Возвращает чистое название, ссылку
 * и, если название похоже на аудиторию («А-234»), корпус и аудиторию.
 */
export function extractAuditoryInfo(lesson: RawScheduleLesson): AuditoryInfo {
  const titles: string[] = []
  const urls: string[] = []

  for (const auditory of lesson.auditories) {
    const { text, href } = stripHtml(auditory.title)
    if (href) urls.push(href)
    if (text) titles.push(text)
  }

  const rooms = titles
    .map((title) => ROOM_PATTERN.exec(title))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ building: match[1]!, room: `${match[1]}-${match[2]}` }))

  const location = lesson.location
    ? stripHtml(lesson.location).text || null
    : titles.join(', ') || null

  return {
    location,
    building: rooms[0]?.building ?? null,
    room: rooms[0]?.room ?? null,
    url: urls[0] ?? null,
  }
}

/** stripHtml вынесен в ./html и реэкспортируется для обратной совместимости. */
export { stripHtml } from './html'

interface LessonDatesInput {
  from: string
  to: string
  semesterStart: string
  week: WeekParity
}

/** Все календарные даты занятия в окне синхронизации с учётом чётности. */
export function lessonDates(
  df: string,
  dt: string,
  weekday: number,
  input: LessonDatesInput,
): string[] {
  const fromMs = Math.max(parseUtcDate(df).getTime(), parseUtcDate(input.from).getTime())
  const toMs = Math.min(parseUtcDate(dt).getTime(), parseUtcDate(input.to).getTime())
  const dates: string[] = []

  let cursor = new Date(fromMs)
  while (cursor.getTime() <= toMs) {
    const utcDay = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay()
    if (utcDay === weekday) {
      const dateStr = formatUtcDate(cursor)
      const parity = weekParityOfDate(dateStr, input.semesterStart)
      const matches = input.week === 'every' || input.week === parity
      if (matches) dates.push(dateStr)
      cursor = addDays(cursor, 7)
      continue
    }
    cursor = addDays(cursor, 1)
  }
  return dates
}

/** '', 'odd'/'lesson_week_odd' → 'odd', 'even'/'lesson_week_even' → 'even'. */
export function parseWeekFlag(week: string): WeekParity {
  if (week === '' ) return 'every'
  if (week === 'odd' || week === 'lesson_week_odd') return 'odd'
  if (week === 'even' || week === 'lesson_week_even') return 'even'
  throw new ScheduleNormalizerError(`Неизвестное значение недели: «${week}»`)
}

function parseUtcDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) throw new ScheduleNormalizerError(`Некорректная дата: ${date}`)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatUtcDate(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** Понедельник недели данной даты (UTC, мс). */
function startOfISOWeekMs(date: Date): number {
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - WEEKDAY_MON)),
  ).getTime()
}

export { MOSCOW_TIME_ZONE }
