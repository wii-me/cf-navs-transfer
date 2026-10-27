import { describe, expect, it } from 'vitest'
import { syncBrowserBookmarks } from '../../worker/lib/db/browserSync'
import { createMutationReceipt } from '../../worker/lib/db/mutation'

type Statement = {
  sql: string
  params: unknown[]
  bind: (...params: unknown[]) => Statement
  all: <T>() => Promise<{ results: T[] }>
  first: <T>() => Promise<T | null>
}

function createBrowserSyncDb(options: { categoryExists?: boolean } = {}) {
  const inserts: Statement[] = []
  const batches: Statement[][] = []
  const categoryExists = options.categoryExists ?? true
  let nextId = 100
  const category = { id: 7, parent_id: null, title: '浏览器新增收藏', icon: null, is_private: 0, sort: 0, created_at: 1 }

  const prepare = (sql: string): Statement => {
    const statement: Statement = {
      sql,
      params: [],
      bind(...params) {
        statement.params = params
        return statement
      },
      async all<T>() {
        if (sql.includes('PRAGMA table_info')) {
          return {
            results: [
              { name: 'icon_source' },
              { name: 'icon_blob' },
              { name: 'icon_background_color' },
              { name: 'description_mode' },
              { name: 'is_private' },
              { name: 'click_count' },
              { name: 'parent_id' },
            ] as T[]
          }
        }
        return { results: [] as T[] }
      },
      async first<T>() {
        if (sql.startsWith('SELECT id, parent_id, title') && categoryExists) return category as T
        return null
      },
    }
    return statement
  }

  const db = {
    prepare,
    async batch(statements: Statement[]) {
      // Ignore the schema-migration batch (DDL / triggers); record only data mutations.
      if (!statements.some((statement) => /^\s*(CREATE|ALTER)\b/.test(statement.sql))) {
        batches.push(statements)
      }
      return statements.map((statement) => {
        if (statement.sql.startsWith('INSERT INTO bookmarks')) {
          inserts.push(statement)
          return { results: [{ id: nextId++ }], meta: { changes: 1 } }
        }
        if (statement.sql.startsWith('INSERT INTO categories')) {
          return { results: [category], meta: { changes: 1 } }
        }
        return { results: [], meta: { changes: 1 } }
      })
    },
  }

  return { db: db as unknown as D1Database, inserts, batches }
}

describe('browser bookmark sync', () => {
  it('persists the default favicon.im candidate for synced bookmarks', async () => {
    const { db, inserts } = createBrowserSyncDb()

    const result = await syncBrowserBookmarks(db, [
      { title: '  Example  ', url: ' https://www.example.com/path ' },
      { title: 'Duplicate', url: 'https://www.example.com/path' },
      { title: 'Unsafe', url: 'javascript:alert(1)' },
    ])

    expect(result).toMatchObject({ created: 1, skipped: 2 })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].params.slice(0, 5)).toEqual([
      7,
      'Example',
      'https://www.example.com/path',
      'https://favicon.im/example.com?larger=true',
      'favicon_im',
    ])
  })

  it('commits every insert and the data_version bump in one batch', async () => {
    const { db, batches } = createBrowserSyncDb()
    const receipt = createMutationReceipt()

    const result = await syncBrowserBookmarks(db, [
      { title: 'A', url: 'https://a.example' },
      { title: 'B', url: 'https://b.example' },
    ], receipt)

    expect(result).toMatchObject({ category_id: 7, created: 2, skipped: 0 })
    expect(batches).toHaveLength(1)
    expect(batches[0].map((statement) => statement.sql.trim().slice(0, 20))).toEqual([
      'INSERT INTO bookmark',
      'INSERT INTO bookmark',
      "INSERT OR REPLACE IN",
    ])
    expect(receipt.data_version).toBe(batches[0][2].params[0])
  })

  it('creates the missing sync category inside the same batch', async () => {
    const { db, batches, inserts } = createBrowserSyncDb({ categoryExists: false })

    const result = await syncBrowserBookmarks(db, [{ title: 'A', url: 'https://a.example' }])

    expect(result).toMatchObject({ category_id: 7, category_title: '浏览器新增收藏', created: 1 })
    expect(batches).toHaveLength(1)
    expect(batches[0][0].sql).toContain('INSERT INTO categories')
    expect(batches[0][0].sql).toContain('WHERE NOT EXISTS')
    // Without a known id the insert resolves the category by subquery in the same transaction.
    expect(inserts[0].sql).toContain('SELECT id FROM categories WHERE parent_id IS NULL AND title = ?')
    expect(inserts[0].params[0]).toBe('浏览器新增收藏')
  })

  it('skips the write and the version bump when nothing new arrives', async () => {
    const { db, batches } = createBrowserSyncDb()
    const receipt = createMutationReceipt()

    const result = await syncBrowserBookmarks(db, [{ title: 'Bad', url: 'ftp://example.com' }], receipt)

    expect(result).toMatchObject({ created: 0, skipped: 1 })
    expect(batches).toHaveLength(0)
    expect(receipt.data_version).toBeNull()
  })
})
