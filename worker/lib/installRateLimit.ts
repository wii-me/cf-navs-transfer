import type { LoginRateLimitState } from '../types'

// 安装与恢复共用的 D1 失败限流。表 install_rate_limits 以 client_key 为主键，
// 调用方传入含命名空间前缀的完整 key（install:<ip> / recover:<ip>），两条流程计数隔离。
export const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

const CREATE_RATE_LIMIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS install_rate_limits (
    client_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  )
`

export async function ensureInstallRateLimitTable(db: D1Database): Promise<void> {
  await db.prepare(CREATE_RATE_LIMIT_TABLE_SQL).run()
}

export async function readInstallFailures(db: D1Database, clientKey: string): Promise<LoginRateLimitState | null> {
  return db
    .prepare('SELECT count, reset_at AS resetAt FROM install_rate_limits WHERE client_key = ?')
    .bind(clientKey)
    .first<LoginRateLimitState>()
}

// 记录一次失败尝试并返回是否已超限。窗口过期则重置计数。
export async function consumeInstallAttempt(db: D1Database, clientKey: string): Promise<boolean> {
  const now = Date.now()
  const result = await db
    .prepare(`
      INSERT INTO install_rate_limits (client_key, count, reset_at)
      VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET
        count = CASE
          WHEN install_rate_limits.reset_at <= ? THEN 1
          ELSE install_rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN install_rate_limits.reset_at <= ? THEN excluded.reset_at
          ELSE install_rate_limits.reset_at
        END
      RETURNING count, reset_at
    `)
    .bind(clientKey, now + RATE_LIMIT_WINDOW_MS, now, now)
    .first<LoginRateLimitState>()
  if (!result) throw new Error('failed to record rate limit attempt')
  return result.resetAt > now && result.count > RATE_LIMIT_MAX_ATTEMPTS
}

export async function clearInstallFailures(db: D1Database, clientKey: string): Promise<void> {
  await db
    .prepare('DELETE FROM install_rate_limits WHERE client_key = ?')
    .bind(clientKey)
    .run()
}
