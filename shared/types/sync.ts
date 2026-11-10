/**
 * Общие типы синхронизации: используются и на сервере, и в клиенте.
 */

/** Чётность недели занятия из источника. Пустая строка = каждая неделя. */
export type WeekParity = 'every' | 'odd' | 'even'

/** Нормализованное занятие — полностью развёрнутое на конкретную дату. */
export interface NormalizedLesson {
  /** Стабильный детерминированный ключ занятия (hex, 32 символа). */
  key: string
  /** Дата занятия, YYYY-MM-DD (Europe/Moscow). */
  date: string
  /** Начало, ISO 8601 с явным смещением, например 2026-11-11T10:40:00+03:00. */
  startsAt: string
  /** Окончание, ISO 8601 с явным смещением. */
  endsAt: string
  /** Название дисциплины. */
  subject: string
  /** Тип занятия (Лекция/Практика/Лаб. работа) или null. */
  lessonType: string | null
  /** Преподаватель или ''. */
  teacher: string
  /** Место проведения (как в источнике: «Webinar», «ПД», аудитория...). */
  location: string
  /** Корпус, если удалось распознать (буква корпуса), иначе null. */
  building: string | null
  /** Аудитория, если известна, иначе null. */
  room: string | null
  /** Ссылка для описания события (вебинар или страница расписания). */
  url: string | null
  /** Полный заголовок события Google: «Дисциплина — тип». */
  title: string
  /** Описание события Google (многострочное). */
  description: string
}

/** Сырой (но уже валидированный Zod) ответ источника. */
export interface RawGroupInfo {
  title: string
  course: number
  dateFrom: string
  dateTo: string
  evening: 0 | 1 | 2
  comment: string | null
}

export interface RawSchedule {
  status: 'ok'
  isSession: boolean
  group: RawGroupInfo
  grid: Record<string, Record<string, RawScheduleLesson[]>>
}

export interface RawScheduleLesson {
  sbj: string
  teacher: string
  teachers: { id: number; name: string }[]
  dts: string
  df: string
  dt: string
  auditories: { title: string; color: string }[]
  shortRooms: string[]
  location: string
  type: string | null
  week: string
  align: string
  e_link: string | null
}

/** Статус отдельной операции синхронизации. */
export type SyncRunStatus = 'running' | 'success' | 'error' | 'blocked'

/** Отчёт о запуске синхронизации — приходит в UI. */
export interface SyncReport {
  runId: number | null
  status: SyncRunStatus
  startedAt: string
  finishedAt: string | null
  createdCount: number
  updatedCount: number
  deletedCount: number
  unchangedCount: number
  errorCount: number
  /** Человекочитаемое сообщение для пользователя (русский). */
  message: string
  /** Детали ошибок (не секретные). */
  errorDetails: string[]
  /** true — нужен явный отказ: источник вернул мало данных для удаления. */
  massDeletionBlocked: boolean
}

/** Ответ GET /api/status. */
export interface StatusResponse {
  connected: boolean
  email: string | null
  calendarName: string | null
  lastSyncAt: string | null
  lastSyncStatus: Exclude<SyncRunStatus, 'running'> | null
  /** Активна ли сессия владельца. */
  authenticated: boolean
}
