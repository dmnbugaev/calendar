import { defineConfig } from 'drizzle-kit'

// Миграции запускаются по ПРЯМОЙ строке подключения (порт 5432/5433),
// не через pgBouncer — см. docs/supabase.md.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? '',
  },
  strict: true,
})
