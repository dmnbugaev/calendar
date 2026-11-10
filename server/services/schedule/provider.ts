import { parseScheduleResponse, ScheduleParseError } from './parser'
import type { RawSchedule } from '#shared/types/sync'

/**
 * UniversityScheduleProvider — получает расписание группы напрямую
 * через подтверждённый JSON API сайта rasp.dmami.ru (см.
 * fixtures/RESEARCH.md). HTML-парсинг не требуется.
 */

const GROUP = '251-362'
const BASE_URL = 'https://rasp.dmami.ru'

/** Ссылка на страницу расписания группы (для описания событий). */
export const SCHEDULE_PAGE_URL = `${BASE_URL}/?g=${GROUP}`

/** Таймаут одного запроса к источнику. */
const FETCH_TIMEOUT_MS = 15_000
/** Количество попыток при сетевых сбоях (не при ошибках валидации). */
const FETCH_RETRIES = 2

export class ScheduleProviderError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message)
    this.name = 'ScheduleProviderError'
  }
}

/** Расписание группы 251-362: API сайта уже проверен этим же приложением. */
export function schedulePageUrl(): string {
  return SCHEDULE_PAGE_URL
}

interface FetchOptions {
  fetchFn?: typeof fetch
  now?: () => Date
}

export class UniversityScheduleProvider {
  private readonly fetchFn: typeof fetch
  private readonly now: () => Date

  constructor(options: FetchOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  /** Получить и провалидировать расписание группы 251-362. */
  async fetchSchedule(): Promise<RawSchedule> {
    let lastError: ScheduleProviderError | null = null

    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt))
      }
      try {
        return await this.fetchOnce()
      } catch (error) {
        if (error instanceof ScheduleParseError) {
          // Ошибки валидации не ретраим: структура не исправится сама.
          throw error
        }
        lastError = error instanceof ScheduleProviderError
          ? error
          : new ScheduleProviderError('Не удалось получить расписание', [String(error)])
      }
    }

    throw lastError ?? new ScheduleProviderError('Не удалось получить расписание')
  }

  private async fetchOnce(): Promise<RawSchedule> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await this.fetchFn(
        `${BASE_URL}/site/group?group=${encodeURIComponent(GROUP)}&session=0`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            // Без Referer сервер отвечает HTTP 500 — обязательный заголовок
            // same-origin AJAX (см. fixtures/RESEARCH.md).
            Referer: `${BASE_URL}/`,
            'User-Agent': 'UniCalendar/1.0 (+https://calendar.dmbugaev.ru)',
          },
        },
      )

      if (!response.ok) {
        throw new ScheduleProviderError(
          `Источник вернул HTTP ${response.status}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new ScheduleProviderError(
          'Источник вернул не-JSON ответ',
        )
      }

      return parseScheduleResponse(payload)
    } catch (error) {
      if (error instanceof ScheduleProviderError || error instanceof ScheduleParseError) {
        throw error
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ScheduleProviderError(
          `Источник не ответил за ${FETCH_TIMEOUT_MS / 1000} с`,
        )
      }
      throw new ScheduleProviderError('Сетевая ошибка при обращении к источнику', [
        error instanceof Error ? error.message : String(error),
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
}

function backoffDelay(attempt: number): number {
  return Math.min(2 ** attempt * 500, 4000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
