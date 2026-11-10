// Nuxt 4: клиентский код — в app/, серверный — в server/, общий — в shared/.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  ssr: true,

  css: ['~/assets/css/main.css'],

  devtools: { enabled: false },

  // Коллекция иконок lucide подключается автоматически через
  // пакет @iconify-json/lucide (devDependencies).
  colorMode: {
    preference: 'system',
    fallback: 'light',
  },

  nitro: {
    // На Vercel Nitro автоматически использует preset `vercel`.
    // Явно не фиксируем, чтобы локальная сборка оставалась Node-сервером.
  },

  // Секреты доступны ТОЛЬКО на сервере (без префикса public*).
  // Значения берутся из environment variables: NUXT_OWNER_EMAIL,
  // NUXT_SESSION_SECRET, NUXT_TOKEN_ENCRYPTION_KEY,
  // NUXT_OAUTH_GOOGLE_CLIENT_ID, NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
  // NUXT_OAUTH_GOOGLE_REDIRECT_URI (опционально), DATABASE_URL.
  runtimeConfig: {
    ownerEmail: '',
    sessionSecret: '',
    tokenEncryptionKey: '',
    cronSecret: '',
    oauth: {
      googleClientId: '',
      googleClientSecret: '',
      googleRedirectUri: '',
    },
  },
})
