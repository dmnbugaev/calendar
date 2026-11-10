---
name: vercel-deployment
description: Подготовка и развёртывание Nuxt-приложения UniCalendar на Vercel. Используй при настройке Nitro-пресета, environment variables, production build, подключении PostgreSQL, OAuth redirect URLs, домена calendar.dmbugaev.ru и проверке HTTPS.
---

# Развёртывание UniCalendar на Vercel

Production domain: **https://calendar.dmbugaev.ru**. Платформа — Vercel, приложение — Nuxt 4 (Nitro).

## Nitro и сборка

- Nuxt автоматически использует Vercel-пресет Nitro на Vercel; не подключай кастомные серверы. Если нужен явный контроль — `nitro: { preset: 'vercel' }` в `nuxt.config.ts`.
- Serverless-ограничения: функции без постоянного состояния, лимит времени выполнения, холодные старты. Долгие операции (массовая синхронизация) проектируй так, чтобы укладывались в лимиты или разбивались на шаги.
- Файловая система функций эфемерна: ничего постоянного не пиши на диск — только в PostgreSQL.
- Перед деплоем всегда проверяй **production build локально**: `npm run build` (и при необходимости `npx nitro preview` / запуск `.output`). Сборка, которая падает локально, на Vercel не проверяется.

## Environment variables (Vercel)

Настраиваются в проекте Vercel, никогда не коммитятся:

- `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` — учётные данные Google OAuth;
- `DATABASE_URL` — pooled-строка подключения Supabase (порт 6543, transaction mode);
- `DATABASE_URL_DIRECT` — прямая строка (порт 5433/5432) только для миграций;
- прочие секреты и флаги по мере появления.

Значения для Production, Preview и Development настраивай раздельно; localhost-redirect не должен попадать в production-конфигурацию.

## OAuth redirect URLs

- В Google Cloud Console (Credentials → OAuth client) authorized redirect URIs должны содержать точные адреса:
  - production: `https://calendar.dmbugaev.ru/api/auth/google/callback` (или фактический маршрут проекта);
  - разработка: отдельный `http://localhost:3000/...` URI.
- `redirect_uri` в запросе должен биться с зарегистрированным символ в символ — иначе Google вернёт `redirect_uri_mismatch`.
- JavaScript origins: `https://calendar.dmbugaev.ru` и `http://localhost:3000`.

## PostgreSQL

- Рантайм приложения — только pooled-подключение (pgBouncer) с `prepare: false` (см. skill `postgres-drizzle`).
- Миграции запускаются не из serverless-функции, а вручную/из CI с прямой строкой подключения.

## Домен и HTTPS

- Домен `calendar.dmbugaev.ru` привязывается к проекту Vercel (Settings → Domains), DNS настраивает пользователь — **агент DNS не меняет**.
- HTTPS обеспечивает Vercel автоматически; после привязки домена проверь `https://calendar.dmbugaev.ru` реально открывается и не отдаёт ошибки сертификата.
- Проверь серверные маршруты в production: авторизация Google, API-эндпоинты отвечают ожидаемо (через Chrome DevTools MCP — network и console).

## Безопасное развёртывание

- Не коммить `.env*`; секреты только в Vercel Environment Variables.
- Не включай debug-режимы и подробные ошибки для пользователей в production.
- После каждого деплоя проверяй: главная страница, OAuth-вход, отсутствие ошибок в консоли и network. Отчёт пользователю — на русском.
