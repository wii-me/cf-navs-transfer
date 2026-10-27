import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import {
  CLICK_RATE_LIMIT_MAX,
  CLICK_RATE_LIMIT_WINDOW_MS,
  clickRateLimitKey,
  recordBookmarkClick,
} from '../../worker/lib/clickRateLimit'
import publicRoutes from '../../worker/routes/public'
import type { Env } from '../../worker/types'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close(); vi.restoreAllMocks() })

function database(source = schema) {
  const instance = createSqliteD1(source)
  open.push(instance)
  instance.sqlite.exec("INSERT INTO categories(id,title,sort,created_at) VALUES(1,'Root',0,1)")
  instance.sqlite.exec("INSERT INTO bookmarks(id,category_id,title,url,sort,created_at) VALUES(1,1,'Public','https://a.example',0,1)")
  instance.sqlite.exec("INSERT INTO bookmarks(id,category_id,title,url,is_private,sort,created_at) VALUES(2,1,'Private','https://b.example',1,1,1)")
  return instance
}

function clicks(instance: ReturnType<typeof createSqliteD1>, id = 1): number {
  return (instance.sqlite.prepare('SELECT click_count AS n FROM bookmarks WHERE id = ?').get(id) as { n: number }).n
}

function limiterRows(instance: ReturnType<typeof createSqliteD1>) {
  return instance.sqlite.prepare('SELECT client_key, count, reset_at FROM click_rate_limits ORDER BY client_key').all() as Array<{ client_key: string; count: number; reset_at: number }>
}

describe('D1 click rate limit', () => {
  it('counts up to the limit per ip and bookmark, then saturates without further writes', async () => {
    const instance = database()
    const now = 1_000_000
    for (let index = 0; index < CLICK_RATE_LIMIT_MAX; index++) {
      expect(await recordBookmarkClick(instance.db, 1, '203.0.113.7', now + index)).toBe('counted')
    }
    expect(await recordBookmarkClick(instance.db, 1, '203.0.113.7', now + 10)).toBe('limited')
    const saturated = limiterRows(instance)
    expect(await recordBookmarkClick(instance.db, 1, '203.0.113.7', now + 11)).toBe('limited')
    expect(clicks(instance)).toBe(CLICK_RATE_LIMIT_MAX)
    // Counter stops at MAX + 1: repeated clicks past the limit do not rewrite the row.
    expect(limiterRows(instance)).toEqual(saturated)
    expect(saturated[0]).toMatchObject({ client_key: clickRateLimitKey('203.0.113.7', 1), count: CLICK_RATE_LIMIT_MAX + 1, reset_at: now + CLICK_RATE_LIMIT_WINDOW_MS })

    // Another client is independent.
    expect(await recordBookmarkClick(instance.db, 1, '198.51.100.1', now + 12)).toBe('counted')
    expect(clicks(instance)).toBe(CLICK_RATE_LIMIT_MAX + 1)
  })

  it('resets after the window and prunes expired rows', async () => {
    const instance = database()
    const now = 2_000_000
    for (let index = 0; index <= CLICK_RATE_LIMIT_MAX; index++) await recordBookmarkClick(instance.db, 1, 'a', now)
    await recordBookmarkClick(instance.db, 1, 'b', now)
    expect(limiterRows(instance)).toHaveLength(2)

    const later = now + CLICK_RATE_LIMIT_WINDOW_MS
    expect(await recordBookmarkClick(instance.db, 1, 'a', later)).toBe('counted')
    // b's expired row was pruned by a's batch; a was recreated with a fresh window.
    expect(limiterRows(instance)).toEqual([{ client_key: clickRateLimitKey('a', 1), count: 1, reset_at: later + CLICK_RATE_LIMIT_WINDOW_MS }])
  })

  it('reports private or missing bookmarks as not found without creating limiter rows', async () => {
    const instance = database()
    expect(await recordBookmarkClick(instance.db, 2, 'a')).toBe('not_found')
    expect(await recordBookmarkClick(instance.db, 999, 'a')).toBe('not_found')
    expect(clicks(instance, 2)).toBe(0)
    expect(limiterRows(instance)).toEqual([])
  })

  it('creates the table on a legacy database through the schema retry', async () => {
    const legacy = schema.replace(/CREATE TABLE IF NOT EXISTS click_rate_limits[\s\S]*?ON click_rate_limits\(reset_at\);/, '')
    expect(legacy).not.toContain('click_rate_limits')
    const instance = database(legacy)
    expect(await recordBookmarkClick(instance.db, 1, 'a')).toBe('counted')
    expect(limiterRows(instance)).toHaveLength(1)
  })

  it('falls back to counting without the limiter when the limiter batch fails', async () => {
    const instance = database()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = { ...instance.db, prepare: instance.db.prepare, batch: async () => { throw new Error('D1 overloaded') } } as unknown as D1Database
    expect(await recordBookmarkClick(db, 1, 'a')).toBe('counted')
    expect(clicks(instance)).toBe(1)
    expect(error).toHaveBeenCalled()
  })
})

describe('POST /api/public/bookmarks/:id/click', () => {
  it('works without a SESSION binding and keeps the envelope contract', async () => {
    const instance = database()
    const env = { DB: instance.db } as Env
    const call = (id: number | string) => publicRoutes.request(`https://navs.example.test/public/bookmarks/${id}/click`, {
      method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' },
    }, env)

    for (let index = 0; index <= CLICK_RATE_LIMIT_MAX; index++) {
      const response = await call(1)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ code: 0, data: null })
    }
    expect(clicks(instance)).toBe(CLICK_RATE_LIMIT_MAX)
    expect((await call(999)).status).toBe(404)
    expect((await call('abc')).status).toBe(400)
  })
})
