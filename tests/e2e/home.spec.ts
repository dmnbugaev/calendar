import { expect, test } from '@playwright/test'

/**
 * E2E-тесты главной страницы UniCalendar.
 * Без секретов и Google: тестируем публичные состояния UI.
 * Расписание — реальные публичные данные университета либо
 * мягкая деградация, если источник недоступен.
 */

test.describe('UniCalendar: главная страница', () => {
  test('рендерится шапка со статусом подключения', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('banner')).toContainText('UniCalendar')
    await expect(page.getByRole('banner')).toContainText('251-362')
    // Бейдж статуса: на мобильных текст скрыт (иконка), но элемент доступен.
    await expect(page.getByLabel('Статус подключения Google: не подключён')).toBeVisible()
  })

  test('панель группы: заголовок и кнопка подключения', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Московский Политех')
    await expect(page.getByRole('button', { name: 'Подключить Google Calendar' })).toBeVisible()
  })

  test('предпросмотр расписания: занятие или корректная деградация', async ({ page }) => {
    await page.goto('/')
    const scheduleCard = page.getByRole('heading', { name: 'Расписание на месяц' })
    await expect(scheduleCard).toBeVisible()

    // Источник доступен → показываются занятия; недоступен → ошибка, не вечная загрузка.
    const dayHeading = page.getByRole('heading', { level: 3 }).first()
    const errorAlert = page.getByText('Не удалось загрузить расписание')
    const emptyState = page.getByText('На ближайший месяц занятий нет')
    await expect(dayHeading.or(errorAlert).or(emptyState).first()).toBeVisible({ timeout: 15_000 })
  })

  test('история синхронизаций: пустое состояние', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'История синхронизаций' })).toBeVisible()
    await expect(page.getByText('Синхронизаций ещё не было.')).toBeVisible({ timeout: 10_000 })
  })

  test('нет ошибок JavaScript и hydration в консоли', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Игнорируем сетевые ошибки источника (внешний сервис), но не JS-ошибки.
    const jsErrors = consoleErrors.filter((e) => !e.includes('rasp.dmami.ru') && !e.includes('Failed to load resource'))
    expect(jsErrors).toEqual([])
  })

  test('mobile 375px: нет горизонтального скролла', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test('переключатель темы работает', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')

    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Переключить тему' }).click()
    await expect(html).toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Переключить тему' }).click()
    await expect(html).not.toHaveClass(/dark/)
  })
})

test.describe('UniCalendar: защита маршрутов', () => {
  // Без настроенных секретов приложение отвечает 503 («не настроено»);
  // с секретами, но без сессии — 401/403. В любом случае синхронизация
  // постороннему недоступна.
  const REFUSED = [401, 403, 503]

  test('POST /api/sync без сессии — отказ', async ({ request }) => {
    const response = await request.post('/api/sync', {
      data: { confirmMassDeletion: false },
      headers: { origin: 'http://localhost:3210' },
    })
    expect(REFUSED).toContain(response.status())
  })

  test('GET /api/status без сессии — connected=false, authenticated=false', async ({ request }) => {
    const response = await request.get('/api/status')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.connected).toBe(false)
    expect(data.authenticated).toBe(false)
    expect(data.email).toBeNull()
  })

  test('POST /api/auth/disconnect без сессии и origin — отказ', async ({ request }) => {
    const response = await request.post('/api/auth/disconnect')
    expect(REFUSED).toContain(response.status())
  })

  test('GET /api/history без сессии — отказ', async ({ request }) => {
    const response = await request.get('/api/history')
    expect(REFUSED).toContain(response.status())
  })

  test('GET /api/cron/sync без токена — отказ (401 или 503 без настройки)', async ({ request }) => {
    const response = await request.get('/api/cron/sync')
    expect([401, 503]).toContain(response.status())
  })

  test('GET /api/cron/sync с неверным токеном — отказ', async ({ request }) => {
    const response = await request.get('/api/cron/sync', {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    expect([401, 503]).toContain(response.status())
  })
})
