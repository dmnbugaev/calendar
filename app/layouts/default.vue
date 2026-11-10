<script setup lang="ts">
// Основной layout: шапка, контейнер, подвал.
</script>

<template>
  <div class="flex min-h-screen flex-col bg-(--ui-bg)">
    <AppHeader />
    <main class="flex-1">
      <UContainer class="py-6 sm:py-10">
        <slot />
      </UContainer>
    </main>
    <footer class="border-t border-(--ui-border)">
      <UContainer class="py-4 text-sm text-(--ui-text-muted)">
        UniCalendar · Московский Политех · группа 251-362
      </UContainer>
    </footer>
  </div>
</template>
