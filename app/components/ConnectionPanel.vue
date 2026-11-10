<script setup lang="ts">
import type { StatusResponse, SyncReport } from '#shared/types/sync'

const props = defineProps<{
  status?: StatusResponse | null
  syncing?: boolean
  report?: SyncReport | null
  /** Флаг: требуется подтверждение массового удаления. */
  massDeletionBlocked?: boolean
}>()

const emit = defineEmits<{
  connect: []
  sync: [confirmMassDeletion: boolean]
  disconnect: []
}>()

const showDisconnectConfirm = ref(false)

const lastSyncText = computed(() => {
  if (!props.status?.lastSyncAt) return 'Ещё не синхронизировалось'
  const d = new Date(props.status.lastSyncAt)
  return `Последняя синхронизация: ${d.toLocaleString('ru-RU')}`
})
</script>

<template>
  <UCard>
    <div class="space-y-6">
      <div class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold sm:text-2xl">
          Московский Политех · группа 251-362
        </h1>
        <p class="text-(--ui-text-muted)">
          Ручная синхронизация расписания с отдельным календарём Google.
        </p>
      </div>

      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div class="flex items-center gap-2">
          <dt class="text-(--ui-text-muted)">Google-аккаунт:</dt>
          <dd class="font-medium">{{ status?.email ?? '—' }}</dd>
        </div>
        <div class="flex items-center gap-2">
          <dt class="text-(--ui-text-muted)">Целевой календарь:</dt>
          <dd class="font-medium">{{ status?.calendarName ?? '—' }}</dd>
        </div>
        <div class="flex items-center gap-2 sm:col-span-2">
          <dt class="text-(--ui-text-muted)">Статус:</dt>
          <dd class="font-medium">{{ lastSyncText }}</dd>
        </div>
      </dl>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <UButton
          v-if="!status?.connected"
          label="Подключить Google Calendar"
          icon="i-lucide-link"
          size="lg"
          :loading="syncing"
          @click="emit('connect')"
        />
        <template v-else>
          <UButton
            label="Синхронизировать расписание"
            icon="i-lucide-refresh-cw"
            size="lg"
            :loading="syncing"
            :disabled="syncing"
            @click="emit('sync', false)"
          />
          <UButton
            v-if="massDeletionBlocked"
            label="Подтвердить массовое удаление"
            icon="i-lucide-triangle-alert"
            color="error"
            size="lg"
            :loading="syncing"
            :disabled="syncing"
            @click="emit('sync', true)"
          />
          <UButton
            v-if="!showDisconnectConfirm"
            label="Отключить"
            color="neutral"
            variant="ghost"
            size="lg"
            @click="showDisconnectConfirm = true"
          />
          <template v-else>
            <UButton
              label="Точно отключить?"
              color="error"
              variant="soft"
              size="lg"
              @click="emit('disconnect'); showDisconnectConfirm = false"
            />
            <UButton
              label="Отмена"
              color="neutral"
              variant="ghost"
              size="lg"
              @click="showDisconnectConfirm = false"
            />
          </template>
        </template>
      </div>

      <SyncReportAlert v-if="report" :report="report" />
    </div>
  </UCard>
</template>
