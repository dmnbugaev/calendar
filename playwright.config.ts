import { defineConfig, devices } from '@playwright/test'

/**
 * E2E-тесты UniCalendar. Запускаются против production-сборки
 * (`nuxt build` + `node .output/server/index.mjs`) или dev-сервера.
 * Google OAuth и БД в тестах не задействованы: секретов нет, статус
 * отвечает connected=false; расписание берётся из реального API
 * университета (публичные данные) с моком при недоступности сети.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3210',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx nuxt dev --port 3210',
        url: 'http://localhost:3210',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
