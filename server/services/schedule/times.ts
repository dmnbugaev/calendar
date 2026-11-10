/**
 * Времена пар Московского Политеха.
 *
 * Значения взяты из клиентского кода сайта rasp.dmami.ru (js/main.js) —
 * таблица `times[evening]`, проверено реальным ответом API 2026-11-10.
 * Ключ — group.evening (0 | 1 | 2), номер пары 1..7.
 *
 * Время московское: Europe/Moscow с 2014 г. — фиксированный UTC+3 без
 * перехода на летнее время, поэтому однозначно сериализуется как `+03:00`.
 */

export const MOSCOW_OFFSET = '+03:00'
export const MOSCOW_TIME_ZONE = 'Europe/Moscow'

const EVENING_0: Record<number, [string, string]> = {
  1: ['09:00', '10:30'],
  2: ['10:40', '12:10'],
  3: ['12:20', '13:50'],
  4: ['14:30', '16:00'],
  5: ['16:10', '17:40'],
  6: ['17:50', '19:20'],
  7: ['19:30', '21:00'],
}

const EVENING_1: Record<number, [string, string]> = {
  ...EVENING_0,
  6: ['18:20', '19:40'],
  7: ['19:50', '21:10'],
}

const EVENING_2: Record<number, [string, string]> = {
  ...EVENING_0,
  6: ['18:30', '20:00'],
  7: ['20:10', '21:40'],
}

const TIMES: Record<0 | 1 | 2, Record<number, [string, string]>> = {
  0: EVENING_0,
  1: EVENING_1,
  2: EVENING_2,
}

/** Начало и конец пары в формате HH:MM или null, если пара не существует. */
export function pairTimes(evening: 0 | 1 | 2, pairNumber: number): [string, string] | null {
  return TIMES[evening][pairNumber] ?? null
}

/** ISO 8601 из даты YYYY-MM-DD и времени HH:MM в московском времени. */
export function moscowIso(date: string, time: string): string {
  return `${date}T${time}:00${MOSCOW_OFFSET}`
}
