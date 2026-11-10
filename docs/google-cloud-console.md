# Инструкция: настройка Google Cloud Console для UniCalendar

Цель: получить OAuth Client ID/Secret и зарегистрировать redirect URI.

## 1. Создание проекта

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Верхнее меню → **Create Project** → имя «UniCalendar» → Create.

## 2. Включение Calendar API

1. Меню → **APIs & Services → Library**.
2. Найдите **Google Calendar API** → **Enable**.

## 3. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User Type: **External** (личный аккаунт не может быть Internal без Workspace) → Create.
3. App name: «UniCalendar», support email — ваш.
4. **Scopes → Add or Remove Scopes**: добавьте
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar`

   (openid/email НЕ нужны: email определяется по id primary-календаря.)
5. **Test users**: добавьте свой Google-аккаунт (`NUXT_OWNER_EMAIL`).
   Пока приложение в статусе Testing, подключение работает только для test users —
   для личного приложения этого достаточно. Publish — по желанию.

## 4. OAuth-клиент

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://calendar.dmbugaev.ru`
4. **Authorized redirect URIs** (символ в символ, иначе `redirect_uri_mismatch`):
   - `http://localhost:3000/api/auth/google/callback`
   - `https://calendar.dmbugaev.ru/api/auth/google/callback`
5. Create → скопируйте **Client ID** и **Client Secret** в переменные
   `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`
   (.env локально, Vercel Environment Variables — в production).

## 5. Проверка

- Локально: `npm run dev` → кнопка «Подключить Google Calendar» → согласие →
  редирект на `/` с тостом «Google Calendar подключён».
- Типичные ошибки:
  - `redirect_uri_mismatch` — URI в консоли не совпадает с фактическим;
  - `access_denied` — аккаунт не в test users;
  - «Google не вернул refresh token» — не был запрошен `prompt=consent`;
    повторите вход (приложение всегда шлёт `access_type=offline&prompt=consent`).
