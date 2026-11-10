import { schedulePreviewSchema } from '#shared/schemas/api'
import { normalizeSchedule } from '../../services/schedule/normalizer'
import { addDaysToDate, moscowToday } from '../../services/sync/window'
import { buildServices } from '../../services/factories'

/**
 * GET /api/schedule/preview — публичный предпросмотр расписания
 * группы на ближайший месяц (данные университета публичны,
 * секреты не задействованы). Занятия по правилам владельца
 * (физподготовка, проектная деятельность, Webinar) не показываются.
 */
export default defineEventHandler(async (event) => {
  const services = buildServices(event)

  const today = moscowToday()
  const to = addDaysToDate(today, 29)

  let raw
  try {
    raw = await services.scheduleProvider.fetchSchedule()
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Не удалось получить расписание университета',
      data: { detail: error instanceof Error ? error.message : String(error) },
    })
  }

  const { lessons } = normalizeSchedule(raw, { window: { from: today, to } })

  // Группировка по датам с сохранением порядка времени.
  const byDate = new Map<string, typeof lessons>()
  for (const lesson of lessons) {
    const list = byDate.get(lesson.date) ?? []
    list.push(lesson)
    byDate.set(lesson.date, list)
  }

  const days = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayLessons]) => ({
      date,
      lessons: dayLessons.map((lesson) => ({
        date: lesson.date,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        title: lesson.title,
        subject: lesson.subject,
        lessonType: lesson.lessonType,
        teacher: lesson.teacher,
        location: lesson.location ?? '',
        building: lesson.building,
        room: lesson.room,
        sourceUrl: 'https://rasp.dmami.ru/?g=251-362',
      })),
    }))

  return schedulePreviewSchema.parse({
    group: raw.group.title,
    from: today,
    to,
    fetchedAt: new Date().toISOString(),
    days,
  })
})
