// 公开点击计数的 D1 限流：每个「来源 IP + 书签 ID」10 分钟内最多计数 3 次。
//
// 之前用 KV 每次点击 get + put：KV 免费额度每天只有 1000 次写入，用完后 put 抛错、
// 限流整体 fail-open，且每次点击两次 KV 往返。现在限流与计数放进同一个 D1 batch：
// 一次往返、写入有界——
//   - 只为「存在且公开」的书签建计数行，随机 ID 不会撑大表；
//   - 计数在 MAX+1 处饱和（ON CONFLICT ... WHERE count <= MAX），超限后的重复点击 0 写入；
//   - 过期行在每个 batch 开头按 reset_at 索引清理，每行只被删除一次。
import { withSchemaRetry } from './db/schema'
import { incrementBookmarkClick } from './db/bookmarks'

export const CLICK_RATE_LIMIT_MAX = 3
export const CLICK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

export type ClickOutcome = 'counted' | 'limited' | 'not_found'

export function clickRateLimitKey(ip: string, bookmarkId: number): string {
  return `${ip || 'unknown'}:${bookmarkId}`
}

async function recordWithRateLimit(db: D1Database, bookmarkId: number, clientKey: string, now: number): Promise<ClickOutcome> {
  const [, , update, state] = await db.batch([
    db.prepare('DELETE FROM click_rate_limits WHERE reset_at <= ?').bind(now),
    db.prepare(`
      INSERT INTO click_rate_limits (client_key, count, reset_at)
      SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM bookmarks WHERE id = ? AND is_private = 0)
      ON CONFLICT(client_key) DO UPDATE SET count = click_rate_limits.count + 1
        WHERE click_rate_limits.count <= ?
    `).bind(clientKey, now + CLICK_RATE_LIMIT_WINDOW_MS, bookmarkId, CLICK_RATE_LIMIT_MAX),
    db.prepare(`
      UPDATE bookmarks SET click_count = COALESCE(click_count, 0) + 1
      WHERE id = ? AND is_private = 0
        AND (SELECT count FROM click_rate_limits WHERE client_key = ?) <= ?
    `).bind(bookmarkId, clientKey, CLICK_RATE_LIMIT_MAX),
    db.prepare('SELECT count FROM click_rate_limits WHERE client_key = ?').bind(clientKey),
  ])
  if ((update?.meta?.changes ?? 0) > 0) return 'counted'
  const count = Number((state?.results?.[0] as { count?: number } | undefined)?.count ?? 0)
  return count > CLICK_RATE_LIMIT_MAX ? 'limited' : 'not_found'
}

/**
 * 登记一次点击。限流是 best-effort：限流 batch 因非 schema 原因失败时退回为不限流的
 * 单条计数（只是计数可能偏高，拒绝匿名点击会让首页功能坏掉）；计数本身失败才抛出。
 */
export async function recordBookmarkClick(
  db: D1Database,
  bookmarkId: number,
  ip: string,
  now = Date.now(),
): Promise<ClickOutcome> {
  const clientKey = clickRateLimitKey(ip, bookmarkId)
  try {
    // 旧库缺表时 withSchemaRetry 触发一次修复式迁移（含建表）后重试。
    return await withSchemaRetry(db, () => recordWithRateLimit(db, bookmarkId, clientKey, now))
  } catch (error) {
    console.error('Failed to apply click count rate limiting:', error)
    return (await incrementBookmarkClick(db, bookmarkId)) ? 'counted' : 'not_found'
  }
}
