import { z } from 'zod'
import type { RawSchedule } from '#shared/types/sync'

/**
 * Zod-схема ответа /site/group. Поля описаны строго по fixture
 * (fixtures/rasp-group-251-362.json, проверен реальным запросом 2026-11-10).
 *
 * Строгие объекты (`.strict()`) обязательны: если структура источника
 * изменится (новые/исчезнувшие поля), парсер упадёт с ясной ошибкой,
 * а не выдаст тихо неверные данные.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/**
 * Возможные значения поля week. В живых данных (65+ групп, 2026-11-10)
 * встречается только `""`; CSS сайта определяет классы
 * `.lesson_week_odd` / `.lesson_week_even`, поэтому допускаем оба вида
 * записи. Всё остальное — ошибка валидации.
 */
const weekValue = z.enum(['', 'odd', 'even', 'lesson_week_odd', 'lesson_week_even'])

const teacherSchema = z
  .strictObject({
    id: z.number(),
    name: z.string(),
  })
  .strict()

const auditorySchema = z
  .strictObject({
    title: z.string(),
    color: z.string(),
  })
  .strict()

const lessonSchema = z
  .strictObject({
    sbj: z.string(),
    teacher: z.string(),
    teachers: z.array(teacherSchema),
    dts: z.string(),
    df: isoDate,
    dt: isoDate,
    auditories: z.array(auditorySchema),
    // shortRooms в fixture всегда []; строковые элементы — осторожное
    // допущение, любое другое содержимое остановит синхронизацию.
    shortRooms: z.array(z.string()),
    location: z.string(),
    type: z.string().nullable(),
    week: weekValue,
    align: z.string(),
    e_link: z.string().nullable(),
  })
  .strict()

const daySchema = z.record(z.string().regex(/^[1-7]$/), z.array(lessonSchema))

const gridSchema = z.record(z.string().regex(/^[1-6]$/), daySchema)

const groupSchema = z
  .strictObject({
    title: z.string(),
    course: z.number(),
    dateFrom: isoDate,
    dateTo: isoDate,
    evening: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    comment: z.string().nullable(),
  })
  .strict()

const okResponseSchema = z
  .strictObject({
    status: z.literal('ok'),
    isSession: z.boolean(),
    group: groupSchema,
    grid: gridSchema,
  })
  .strict()

const errorResponseSchema = z
  .strictObject({
    status: z.literal('error'),
    message: z.string(),
  })
  .strict()

const responseSchema = z.union([okResponseSchema, errorResponseSchema])

export class ScheduleParseError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message)
    this.name = 'ScheduleParseError'
  }
}

/**
 * Валидирует и разбирает JSON-ответ источника.
 * Ответ с `status: "error"` превращается в исключение с сообщением вуза.
 * Ответ в session-режиме (isSession=true) не поддерживается — для группы
 * 251-362 session-расписание отсутствует (проверено 2026-11-10).
 */
export function parseScheduleResponse(payload: unknown): RawSchedule {
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) {
    const details = z.treeifyError(parsed.error).errors
    throw new ScheduleParseError('Источник вернул неожиданную структуру данных', details)
  }

  if (parsed.data.status === 'error') {
    throw new ScheduleParseError(
      `Источник вернул ошибку: ${parsed.data.message}`,
    )
  }

  if (parsed.data.isSession) {
    throw new ScheduleParseError(
      'Источник вернул расписание в session-режиме, который приложение не поддерживает',
    )
  }

  return parsed.data satisfies RawSchedule
}
