import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest для unit-тестов. Алиас #shared указывает на общий код,
 * как в Nuxt. Интеграционные тесты с БД включаются при заданном
 * TEST_DATABASE_URL (проверка миграций и репозитория).
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})
