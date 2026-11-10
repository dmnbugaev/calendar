/**
 * GoogleCalendarService — тонкий типизированный REST-клиент Calendar API
 * (v3, документация проверена 2026-11-10: calendars.insert, calendarList.list,
 * events.list/insert/update/delete). Без SDK: нативный fetch достаточно.
 *
 * Политика ошибок (skill google-calendar-oauth):
 *  - 401 → обновить токен и повторить запрос ОДИН раз;
 *  - 403 rateLimitExceeded/quotaExceeded, 5xx → экспоненциальная задержка;
 *  - 403 calendarUseRevoked → пометить интеграцию неактивной;
 *  - 404 → событие/календарь уже нет — не падать (расхождение в журнале).
 */

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const MAX_ATTEMPTS = 4
const MAX_RESULTS_PAGE = 2500

export const SCHEDULE_CALENDAR_NAME = 'Московский Политех | 251-362'
export const SCHEDULE_CALENDAR_DESCRIPTION = 'Расписание группы 251-362 (UniCalendar)'

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly reason: string | null = null,
  ) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

export class CalendarAccessRevokedError extends GoogleCalendarError {
  constructor(message = 'Доступ к Google Calendar отозван') {
    super(message, 403, 'calendarUseRevoked')
    this.name = 'CalendarAccessRevokedError'
  }
}

export interface CalendarEvent {
  id: string
  summary: string | null
  description: string | null
  location: string | null
  start: { dateTime?: string; date?: string; timeZone?: string } | null
  end: { dateTime?: string; date?: string; timeZone?: string } | null
  extendedProperties: { private?: Record<string, string> } | null
}

export interface GoogleEventPayload {
  summary: string
  description: string
  location: string | null
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  /** Маркеры приложения: unicalendarKey, unicalendarApp, unicalendarPayloadHash. */
  extendedProperties: { private: Record<string, string> }
  reminders: { useDefault: boolean }
}

/**
 * Поставщик access token: getToken() возвращает токен из кэша/БД,
 * refresh() вызывается после 401 и должен вернуть заведомо свежий токен.
 */
export interface GoogleTokenProvider {
  getToken(): Promise<string>
  refresh(): Promise<string>
}

/** Флаг: токен только что был обновлён после 401 — повторять нельзя больше одного раза. */
interface RetryContext {
  tokenWasRefreshed: boolean
}

export class GoogleCalendarService {
  constructor(
    private readonly tokenProvider: GoogleTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleepFn: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /**
   * Найти наш календарь расписания по имени или создать новый.
   * Не создаёт дубликат: сначала calendarList, потом calendars.insert.
   */
  async ensureScheduleCalendar(calendarName: string): Promise<string> {
    const listed = await this.request<{ items?: { id?: string; summary?: string }[] }>(
      '/users/me/calendarList',
    )
    const existing = (listed.items ?? []).find(
      (item) => item.summary === calendarName && item.id,
    )
    if (existing?.id) return existing.id

    const created = await this.request<{ id: string }>('/calendars', {
      method: 'POST',
      body: JSON.stringify({
        summary: calendarName,
        description: SCHEDULE_CALENDAR_DESCRIPTION,
        timeZone: 'Europe/Moscow',
      }),
    })
    if (!created.id) {
      throw new GoogleCalendarError('Google не вернул id созданного календаря')
    }
    return created.id
  }

  /** Все события календаря в окне [timeMin, timeMax) — с пагинацией. */
  async listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = []
    let pageToken: string | undefined

    do {
      const query = new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: String(MAX_RESULTS_PAGE),
        singleEvents: 'false',
        showDeleted: 'false',
      })
      if (pageToken) query.set('pageToken', pageToken)

      const page = await this.request<{ items?: CalendarEvent[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      )
      events.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)

    return events
  }

  async insertEvent(calendarId: string, payload: GoogleEventPayload): Promise<CalendarEvent> {
    return this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    payload: GoogleEventPayload,
  ): Promise<CalendarEvent> {
    return this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    )
  }

  /**
   * Удаление события. 404 (уже удалено) — не ошибка: фиксируем как успех.
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.requestVoid(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  }

  // ------------------------------------------------------------------

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.requestWithRetry(path, init)
    const data = (await response.json()) as T
    return data
  }

  private async requestVoid(path: string, init?: RequestInit): Promise<void> {
    const response = await this.requestWithRetry(path, init)
    void response
  }

  private async requestWithRetry(path: string, init?: RequestInit): Promise<Response> {
    const ctx: RetryContext = { tokenWasRefreshed: false }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const token = await this.tokenProvider.getToken()
      const response = await this.fetchFn(`${CALENDAR_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })

      if (response.ok) return response

      const { status, reason } = await errorInfo(response)

      // 401: обновить токен и повторить ОДИН раз.
      if (status === 401 && !ctx.tokenWasRefreshed) {
        ctx.tokenWasRefreshed = true
        await this.tokenProvider.refresh()
        continue
      }

      // calendarUseRevoked — не ретраим, интеграция отключена.
      if (reason === 'calendarUseRevoked') {
        throw new CalendarAccessRevokedError()
      }

      const retriable
        = status === 403 && (reason === 'rateLimitExceeded' || reason === 'quotaExceeded')
          || status === 429
          || status >= 500

      if (retriable && attempt < MAX_ATTEMPTS) {
        await this.sleepFn(backoffDelay(attempt))
        continue
      }

      throw new GoogleCalendarError(
        googleErrorText(status, reason, path),
        status,
        reason,
      )
    }

    throw new GoogleCalendarError(`Google Calendar API не ответил после ${MAX_ATTEMPTS} попыток`, 500)
  }
}

async function errorInfo(response: Response): Promise<{ status: number; reason: string | null }> {
  const status = response.status
  let reason: string | null = null
  try {
    const body = (await response.json()) as {
      error?: { errors?: { reason?: string }[]; message?: string }
    }
    reason = body.error?.errors?.[0]?.reason ?? null
  } catch {
    // Тело без JSON — используем только статус.
  }
  return { status, reason }
}

function googleErrorText(status: number, reason: string | null, path: string): string {
  const suffix = reason ? ` (${reason})` : ''
  const action = status === 404
    ? 'Событие или календарь уже не существует'
    : 'Запрос к Google Calendar API не выполнен'
  return `${action}: HTTP ${status}${suffix} [${path}]`
}

function backoffDelay(attempt: number): number {
  // Экспоненциальная задержка с джиттером: 0.5–1.5 c, 1–3 c, 2–6 c...
  const base = Math.min(2 ** (attempt - 1) * 500, 8000)
  return Math.round(base * (0.5 + Math.random()))
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
