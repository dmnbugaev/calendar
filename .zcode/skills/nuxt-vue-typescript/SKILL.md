---
name: nuxt-vue-typescript
description: Правила разработки Nuxt 4 + Vue 3 + TypeScript для проекта UniCalendar. Используй при создании компонентов, страниц, composables, серверных маршрутов Nitro, при вопросах о структуре проекта Nuxt, SSR/hydration и строгой типизации.
---

# Разработка на Nuxt 4, Vue 3 и TypeScript

Проект UniCalendar строится на Nuxt 4, Vue 3 (Composition API) и TypeScript strict. Этот skill задаёт обязательные правила разработки.

## Обязательные правила

### Компоненты и состояние

- Используй только **Composition API** и `<script setup lang="ts">`. Options API не применяй.
- Не используй `class`-компоненты и миксины.
- Состояние — через `ref`/`reactive`/`computed`/`watch` из Vue 3, глобальное — через `useState` Nuxt или composables.
- Компоненты держи компактными; переиспользуемая логика — в composables (`app/composables/`).

### Строгая типизация

- TypeScript strict обязателен. Не используй `any` без веской причины (если иначе никак — оставляй комментарий с объяснением).
- Типы для пропсов — через `defineProps<{ ... }>()` с интерфейсами, события — через `defineEmits`.
- API-ответы валидируй через **Zod**-схемы и выводи типы из схем (`z.infer`).
- Не дублируй типы вручную там, где можно вывести их из схемы или функции.

### Возможности Nuxt — в приоритете

- Предпочитай нативные механизмы Nuxt вместо сторонних библиотек: `useFetch`/`useAsyncData` вместо axios, `definePageMeta`, auto-imports, `navigateTo`, `defineNuxtRouteMiddleware`.
- Файловая маршрутизация — в `app/pages/`; layout — в `app/layouts/`.
- В Nuxt 4 структура каталогов: `app/` (клиентская часть), `server/` (серверная), `shared/` (общий код).

### Сервер и клиент

- Backend — **Nitro** server routes (`server/api/`, `server/routes/`). Не поднимай отдельный бэкенд-сервис.
- Чётко разделяй серверный и клиентский код: секреты, ключи и работа с БД — только в `server/`.
- Секреты — только через `runtimeConfig` на стороне сервера (`runtimeConfig.serverSecret` / `serverRuntimeConfig`); ключи с префиксом, доступным клиенту, запрещено использовать для секретов.
- Не импортируй серверные модули в клиентский код и наоборот; общий код — в `shared/`.

### SSR и hydration

- Любая новая страница/компонент проверяется на корректность SSR и hydration: отсутствие ошибок mismatch в консоли.
- `localStorage`, `window`, `document` — только в хуках `onMounted` / клиентских плагинах или под `import.meta.client`.
- Данные для SSR загружай через `useAsyncData`/`useFetch`, а не в `setup` вручную.

### Документация

- Перед реализацией сложных функций (новые API Nuxt, изменения поведения между версиями) получай актуальную документацию через **Context7 MCP** (`/nuxt/nuxt`, `/vuejs/vue`, `/nitrojs/nitro`). Не полагайся на память о старых версиях.

## Запрещено

- React, Next.js, JSX — проект на Vue.
- Options API, `Vue.prototype`, глобальные миксины.
- Хранение секретов в клиентском коде, `public/` или конфигах, попадающих в бандл.
- Установка тяжёлых библиотек там, где есть нативное решение Nuxt/Vue.
