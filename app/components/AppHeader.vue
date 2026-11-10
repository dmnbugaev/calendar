<script setup lang="ts">
import type { StatusResponse } from '#shared/types/sync'

// Шапка сама получает статус (useFetch дедуплицируется с запросом страницы).
const { data: status } = await useFetch<StatusResponse>('/api/status')

const colorMode = useColorMode()

function toggleTheme(): void {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>


<template>
  <header class="border-b border-(--ui-border)">
    <UContainer class="flex h-14 items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-calendar-check" class="size-6 text-(--ui-primary)" />
        <span class="text-lg font-semibold">UniCalendar</span>
        <UBadge label="251-362" variant="subtle" color="neutral" />
      </div>

      <div class="flex items-center gap-1.5 sm:gap-3">
        <UBadge
          v-if="status?.connected"
          color="success"
          variant="subtle"
          icon="i-lucide-check-circle-2"
          aria-label="Статус подключения Google: подключён"
          class="max-w-[46vw] sm:max-w-none"
        >
          <span class="hidden sm:inline truncate">Google подключён</span>
        </UBadge>
        <UBadge
          v-else
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
          aria-label="Статус подключения Google: не подключён"
          class="max-w-[46vw] sm:max-w-none"
        >
          <span class="hidden sm:inline truncate">Google не подключён</span>
        </UBadge>
        <ClientOnly>
          <UButton
            :icon="colorMode.preference === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            variant="ghost"
            color="neutral"
            aria-label="Переключить тему"
            @click="toggleTheme"
          />
        </ClientOnly>
      </div>
    </UContainer>
  </header>
</template>
