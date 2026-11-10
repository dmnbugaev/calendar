<script setup lang="ts">
import type { StatusResponse, SyncReport } from '#shared/types/sync'
import type { HistoryRun } from '../components/SyncHistoryCard.vue'

useHead({
  title: 'UniCalendar — расписание Московского Политеха',
  htmlAttrs: { lang: 'ru' },
})

const route = useRoute()

// Статус подключения (SSR).
const { data: status, refresh: refreshStatus } = await useFetch<StatusResponse>('/api/status')

// Предпросмотр расписания (SSR; источник может быть недоступен — обрабатываем ошибку).
const { data: preview, pending: previewPending, error: previewError, refresh: refreshPreview }
  = await useFetch('/api/schedule/preview')

const report = ref<SyncReport | null>(null)
const syncing = ref(false)
const syncError = ref<string | null>(null)

// История — загружаем только после входа.
const history = ref<HistoryRun[]>([])
const historyLoading = ref(false)

async function loadHistory(): Promise<void> {
  if (!status.value?.authenticated) {
    history.value = []
    return
  }
  historyLoading.value = true
  try {
    const data = await $fetch<{ runs: HistoryRun[] }>('/api/history')
    history.value = data.runs
  } catch {
    history.value = []
  } finally {
    historyLoading.value = false
  }
}

onMounted(() => {
  // Сообщения OAuth callback (?authSuccess=1 / ?authError=...).
  if (route.query.authSuccess) {
    useToast().add({ title: 'Google Calendar подключён', color: 'success', icon: 'i-lucide-check-circle-2' })
    navigateTo({ path: '/' }, { replace: true })
  } else if (typeof route.query.authError === 'string') {
    useToast().add({ title: 'Ошибка подключения', description: route.query.authError, color: 'error', icon: 'i-lucide-alert-circle' })
    navigateTo({ path: '/' }, { replace: true })
  }
  void loadHistory()
})

async function connect(): Promise<void> {
  // Топ-левел переход на старт OAuth ( Nitro редиректит на Google).
  await navigateTo('/api/auth/google', { external: true })
}

async function runSync(confirmMassDeletion = false): Promise<void> {
  syncing.value = true
  syncError.value = null
  try {
    report.value = await $fetch<SyncReport>('/api/sync', {
      method: 'POST',
      body: { confirmMassDeletion },
    })
    await Promise.all([refreshStatus(), loadHistory(), refreshPreview()])
    if (report.value.status === 'success') {
      useToast().add({ title: 'Синхронизация выполнена', color: 'success', icon: 'i-lucide-check-circle-2' })
    }
  } catch (error) {
    const message = error instanceof Error
      ? (error as { statusCode?: number; statusMessage?: string }).statusMessage ?? error.message
      : 'Неизвестная ошибка'
    syncError.value = message
    useToast().add({ title: 'Не удалось синхронизировать', description: message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function disconnect(): Promise<void> {
  syncing.value = true
  try {
    await $fetch('/api/auth/disconnect', { method: 'POST' })
    report.value = null
    await refreshStatus()
    history.value = []
    useToast().add({ title: 'Аккаунт отключён', color: 'neutral' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось отключить аккаунт'
    useToast().add({ title: 'Ошибка отключения', description: message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

const previewErrorText = computed(() =>
  previewError.value
    ? (previewError.value as { statusMessage?: string }).statusMessage
      ?? 'Источник расписания недоступен'
    : null,
)

const massDeletionBlocked = computed(() => report.value?.massDeletionBlocked === true)
</script>

<template>
  <div class="space-y-6">
    <ConnectionPanel
      :status="status"
      :syncing="syncing"
      :report="report"
      :mass-deletion-blocked="massDeletionBlocked"
      @connect="connect"
      @sync="runSync"
      @disconnect="disconnect"
    />

    <UAlert
      v-if="syncError && !report"
      color="error"
      variant="soft"
      title="Ошибка синхронизации"
      :description="syncError"
      icon="i-lucide-alert-circle"
    />

    <div class="grid gap-6 lg:grid-cols-2">
      <SchedulePreviewCard
        :preview="preview"
        :loading="previewPending"
        :error="previewErrorText"
      />
      <SyncHistoryCard :runs="history" :loading="historyLoading" />
    </div>
  </div>
</template>
