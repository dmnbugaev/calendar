import type { RawScheduleLesson } from '#shared/types/sync'
import { stripHtml } from './html'

/**
 * Правила исключения занятий из синхронизации и предпросмотра.
 *
 * По требованию владельца не переносятся в Google Calendar:
 *  - занятия по физической подготовке (спортзал);
 *  - «Проектная деятельность»;
 *  - онлайн-занятия с пометкой «Webinar» (по месту проведения).
 *
 * Правила применяются к сырому занятию ДО разворота дат — отфильтрованное
 * занятие не попадает ни в предпросмотр, ни в календарь.
 */

// ВАЖНО: \w в JS-регулярках не покрывает кириллицу — используем [а-яё].
const EXCLUDED_SUBJECT_PATTERNS: RegExp[] = [
  // «Общая физическая подготовка», «Элективные дисциплины по физической
  // культуре», «Физкультура» и т.п.
  /физическ[а-яё]*\s+(подготовк|культур)/i,
  /физкультур/i,
  // «Проектная деятельность»
  /проектн[а-яё]*\s+деятельн/i,
]

/** Порог «webinar» в месте проведения (регистронезависимо). */
const WEBINAR_MARKER = /webinar/i

export interface LessonExclusion {
  excluded: true
  /** Причина для журнала: человекочитаемая. */
  reason: string
}

export type LessonFilterResult = { excluded: false } | LessonExclusion

/**
 * Проверяет, подлежит ли занятие исключению.
 * Не выбрасывает ошибок: фильтр не должен останавливать синхронизацию.
 */
export function checkLessonExclusion(lesson: RawScheduleLesson): LessonFilterResult {
  const subject = lesson.sbj.trim()

  for (const pattern of EXCLUDED_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { excluded: true, reason: `предмет «${subject}» в списке исключений` }
    }
  }

  const places: string[] = []
  if (lesson.location) places.push(lesson.location)
  for (const auditory of lesson.auditories) {
    const { text } = stripHtml(auditory.title)
    if (text) places.push(text)
  }
  if (places.some((place) => WEBINAR_MARKER.test(place))) {
    return { excluded: true, reason: `«${subject}» проходит онлайн (Webinar)` }
  }

  return { excluded: false }
}
