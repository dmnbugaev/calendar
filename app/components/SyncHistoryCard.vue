<script setup lang="ts">
export interface HistoryRun {
  id: number
  status: string
  startedAt: string
  finishedAt: string | null
  createdCount: number
  updatedCount: number
  deletedCount: number
  unchangedCount: number
  errorCount: number
  message: string | null
}

const props = defineProps<{
  runs: HistoryRun[]
  loading: boolean
}>()

function dateLabel(run: HistoryRun): string {
  return new Date(run.startedAt).toLocaleString('ru-RU')
}

const statusColor = (status: string) => {
  if (status === 'success') return 'success' as const
  if (status === 'blocked') return 'warning' as const
  if (status === 'running') return 'info' as const
  return 'error' as const
}

const statusLabel = (status: string) => {
  if (status === 'success') return 'Успех'
  if (status === 'blocked') return 'Требует подтверждения'
  if (status === 'running') return 'Выполняется'
  return 'Ошибка'
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-history" class="size-5 text-(--ui-primary)" />
        <h2 class="text-lg font-semibold">
          История синхронизаций
        </h2>
      </div>
    </template>

    <div v-if="props.loading" class="flex items-center gap-3 py-6 text-(--ui-text-muted)">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
      Загружаем историю…
    </div>

    <p v-else-if="props.runs.length === 0" class="py-6 text-center text-(--ui-text-muted)">
      Синхронизаций ещё не было.
    </p>

    <ul v-else class="divide-y divide-(--ui-border)">
      <li v-for="run in props.runs" :key="run.id" class="py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UBadge :label="statusLabel(run.status)" :color="statusColor(run.status)" variant="subtle" />
            <span class="text-sm">{{ dateLabel(run) }}</span>
          </div>
          <span class="text-sm text-(--ui-text-muted)">
            +{{ run.createdCount }} / ~{{ run.updatedCount }} / −{{ run.deletedCount }} / ={{ run.unchangedCount }}
            <span v-if="run.errorCount" class="text-(--ui-text-error)"> · ошибок: {{ run.errorCount }}</span>
          </span>
        </div>
        <p v-if="run.message" class="mt-1 text-sm text-(--ui-text-muted)">
          {{ run.message }}
        </p>
      </li>
    </ul>
  </UCard>
</template>
