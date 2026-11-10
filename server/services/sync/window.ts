/**
 * Работа с датами в Europe/Moscow (фиксированный UTC+3 с 2014 г.).
 * Московская календарная дата = UTC-дата смещения +03:00.
 */

/** Московская дата «сегодня» в формате YYYY-MM-DD. */
export function moscowToday(now: Date = new Date()): string {
  return formatMoscowDate(now)
}

/** YYYY-MM-DD в московском времени для данного момента. */
export function formatMoscowDate(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${m}-${d}`
}

/** Наивная московская дата → Date (UTC-представление календарной даты). */
export function parseMoscowDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Некорректная дата: ${date}`)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Прибавить N дней к дате YYYY-MM-DD → YYYY-MM-DD. */
export function addDaysToDate(date: string, days: number): string {
  const base = parseMoscowDate(date)
  return formatMoscowDate(new Date(base.getTime() + days * 86_400_000))
}
