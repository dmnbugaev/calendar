<script setup lang="ts">
import type { z } from 'zod'
import type { schedulePreviewSchema } from '#shared/schemas/api'

type Preview = z.infer<typeof schedulePreviewSchema>

const props = defineProps<{
  preview?: Preview | null
  loading?: boolean
  error?: string | null
}>()

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(y!, m! - 1, d))
  const weekday = WEEKDAYS[utc.getUTCDay()]
  return `${weekday}, ${d} ${MONTHS[m! - 1]} ${y}`
}

function time(iso: string): string {
  // 2026-11-11T10:40:00+03:00 → 10:40
  return iso.slice(11, 16)
}

function dayKey(date: string): string {
  return `${date}-${dateLabel(date)}`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-calendar-days" class="size-5 text-(--ui-primary)" />
        <h2 class="text-lg font-semibold">
          Расписание на 7 дней
        </h2>
      </div>
    </template>

    <div v-if="props.loading" class="flex items-center gap-3 py-8 justify-center text-(--ui-text-muted)">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      Загружаем расписание университета…
    </div>

    <UAlert
      v-else-if="props.error"
      color="error"
      variant="soft"
      title="Не удалось загрузить расписание"
      :description="props.error"
      icon="i-lucide-alert-circle"
    />

    <div v-else-if="!props.preview || props.preview.days.length === 0" class="py-8 text-center text-(--ui-text-muted)">
      <UIcon name="i-lucide-coffee" class="mx-auto size-8 mb-2" />
      В ближайшие 7 дней занятий нет.
    </div>

    <div v-else class="space-y-5">
      <div v-for="day in props.preview.days" :key="dayKey(day.date)">
        <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
          {{ dateLabel(day.date) }}
        </h3>
        <ul class="space-y-2">
          <li
            v-for="lesson in day.lessons"
            :key="lesson.startsAt + lesson.title"
            class="flex gap-3 rounded-(--ui-radius) border border-(--ui-border) p-3"
          >
            <div class="w-24 shrink-0 text-sm font-medium tabular-nums">
              {{ time(lesson.startsAt) }}–{{ time(lesson.endsAt) }}
            </div>
            <div class="min-w-0">
              <p class="font-medium leading-snug">
                {{ lesson.subject }}
                <span v-if="lesson.lessonType" class="text-(--ui-text-muted)">— {{ lesson.lessonType }}</span>
              </p>
              <p v-if="lesson.teacher" class="text-sm text-(--ui-text-muted)">
                {{ lesson.teacher }}
              </p>
              <p v-if="lesson.location" class="text-sm text-(--ui-text-muted)">
                <UIcon name="i-lucide-map-pin" class="inline size-3.5 align-[-1px]" />
                {{ lesson.location }}<template v-if="lesson.room"> · {{ lesson.room }}</template>
              </p>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <p class="text-xs text-(--ui-text-muted)">
        Источник: <a
          href="https://rasp.dmami.ru/?g=251-362"
          target="_blank"
          rel="noopener"
          class="underline"
        >rasp.dmami.ru</a>
        <span v-if="props.preview"> · обновлено {{ new Date(props.preview.fetchedAt).toLocaleTimeString('ru-RU') }}</span>
      </p>
    </template>
  </UCard>
</template>
