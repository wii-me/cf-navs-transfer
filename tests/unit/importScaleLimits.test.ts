import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { Bookmark, Category } from '../../shared/types'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import { importData } from '../../worker/lib/db/import'
import { MAX_IMPORT_BOOKMARKS, MAX_IMPORT_CATEGORIES } from '../../worker/lib/importValidation'

// 代码审查三轮第 34 项：最大规模导入（2000 分类 + 20000 书签）整体放进一个 D1 batch。
// D1 的单语句限制（每条最多 100 个绑定参数、SQL 文本最多 100 KB）对 batch 中每条语句分别生效，
// 这里在真实 SQLite 上执行一遍，逐条核对；整体耗时上限（30 秒）只能在线上验证。
const D1_MAX_BOUND_PARAMS = 100
const D1_MAX_SQL_BYTES = 100_000

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close() })

function recordingDatabase() {
  const instance = createSqliteD1(schema)
  open.push(instance)
  const batches: Array<Array<{ sql: string; bindings: unknown[] }>> = []
  const originalBatch = instance.db.batch.bind(instance.db)
  ;(instance.db as unknown as { batch: (items: Array<{ sql: string; bindings: unknown[] }>) => Promise<unknown> }).batch = async (items) => {
    batches.push(items.map((item) => ({ sql: item.sql, bindings: item.bindings })))
    return originalBatch(items as never)
  }
  return { ...instance, batches }
}

describe('maximum-size import against D1 per-statement limits', () => {
  it('imports the validation maximum in one batch with every statement inside D1 limits', async () => {
    const { db, sqlite, batches } = recordingDatabase()
    const categories = Array.from({ length: MAX_IMPORT_CATEGORIES }, (_, index): Category => ({
      id: index + 1,
      parent_id: index < 20 ? null : (index % 20) + 1,
      title: `分类 ${index} ${'x'.repeat(60)}`,
      icon: index % 3 === 0 ? 'mdi:folder' : null,
      sort: index,
      created_at: 1,
    }))
    const bookmarks = Array.from({ length: MAX_IMPORT_BOOKMARKS }, (_, index): Bookmark => ({
      id: index + 1,
      category_id: (index % MAX_IMPORT_CATEGORIES) + 1,
      title: `书签 ${index} ${'y'.repeat(80)}`,
      url: `https://example-${index}.com/${'p'.repeat(200)}`,
      icon: null,
      icon_source: null,
      icon_background_color: null,
      icon_blob: null,
      description: 'd'.repeat(200),
      open_method: 1,
      sort: index,
      created_at: 1,
    }))

    const result = await importData(db, { categories, bookmarks })

    expect(result.categories).toBe(MAX_IMPORT_CATEGORIES)
    expect(result.bookmarks).toBe(MAX_IMPORT_BOOKMARKS)
    const counts = sqlite.prepare('SELECT (SELECT COUNT(*) FROM categories) AS c, (SELECT COUNT(*) FROM bookmarks) AS b').get() as { c: number; b: number }
    expect(counts).toEqual({ c: MAX_IMPORT_CATEGORIES, b: MAX_IMPORT_BOOKMARKS })

    const importBatch = batches.at(-1)!
    expect(importBatch.length).toBeGreaterThan(3000)
    for (const statement of importBatch) {
      expect(statement.bindings.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
      expect(Buffer.byteLength(statement.sql, 'utf8')).toBeLessThanOrEqual(D1_MAX_SQL_BYTES)
    }
  }, 60_000)
})
