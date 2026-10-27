// 点击计数限流表。Keep schema.sql in sync; schema step 3 (worker/lib/db/schema.ts) creates these for existing installs.
export const CLICK_RATE_LIMIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS click_rate_limits (
    client_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_click_rate_limits_reset ON click_rate_limits(reset_at)',
]
