<script setup lang="ts">
import type { SyncReport } from '#shared/types/sync'

const props = defineProps<{
  report: SyncReport
}>()

const color = computed(() => {
  if (props.report.status === 'success') return 'success' as const
  if (props.report.status === 'blocked') return 'warning' as const
  return 'error' as const
})

const title = computed(() => {
  if (props.report.status === 'success') return 'Синхронизация завершена'
  if (props.report.status === 'blocked') return 'Требуется подтверждение'
  return 'Синхронизация завершена с ошибками'
})
</script>

<template>
  <UAlert
    :color="color"
    variant="soft"
    :title="title"
    :description="report.message"
    :icon="report.status === 'success' ? 'i-lucide-check-circle-2' : 'i-lucide-alert-circle'"
  >
    <template #description>
      <p>{{ report.message }}</p>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>Создано: {{ report.createdCount }}</span>
        <span>Обновлено: {{ report.updatedCount }}</span>
        <span>Удалено: {{ report.deletedCount }}</span>
        <span>Без изменений: {{ report.unchangedCount }}</span>
        <span>Ошибок: {{ report.errorCount }}</span>
      </div>
      <ul v-if="report.errorDetails.length" class="mt-2 list-disc pl-5 text-sm">
        <li v-for="detail in report.errorDetails.slice(0, 5)" :key="detail">
          {{ detail }}
        </li>
      </ul>
    </template>
  </UAlert>
</template>
