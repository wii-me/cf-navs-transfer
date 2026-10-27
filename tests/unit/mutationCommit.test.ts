import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import { iconFixture } from '../helpers/iconFixture'
import {
  batchDeleteBookmarks,
  createBookmark,
  deleteBookmark,
  getBookmarkIconData,
  setIconBlob,
  sortBookmarks,
  updateBookmark,
} from '../../worker/lib/db/bookmarks'
import { batchDeleteCategories, createCategory, deleteCategory, updateCategory } from '../../worker/lib/db/categories'
import { ensureBrowserSyncCategoryStatement } from '../../worker/lib/db/browserSync'
import { importData } from '../../worker/lib/db/import'
import { Mutation, commitMutation, createMutationReceipt } from '../../worker/lib/db/mutation'
import { updateSettings, writeSettingsPatch } from '../../worker/lib/db/settings'
import { mutationJson } from '../../worker/lib/mutationResponse'
import type { HonoEnv } from '../../worker/types'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close() })

function database() {
  const instance = createSqliteD1(schema)
  open.push(instance)
  instance.sqlite.exec("INSERT INTO categories(id,title,sort,created_at) VALUES(1,'Root',0,1)")
  instance.sqlite.exec("INSERT OR REPLACE INTO settings(key,value) VALUES('data_version','\"v0\"')")
  return instance
}

function version(instance: ReturnType<typeof createSqliteD1>): string {
  const row = instance.sqlite.prepare("SELECT value FROM settings WHERE key='data_version'").get() as { value: string }
  return JSON.parse(row.value) as string
}

const bookmark = (overrides: Record<string, unknown> = {}) => ({
  category_id: 1, title: 'Fixture', url: 'https://example.com', icon: 'https://example.com/a.svg', ...overrides,
})

describe('commitMutation: business write and data_version share one batch', () => {
  it('reports the exact committed version on create and leaves it untouched for a missing category', async () => {
    const instance = database()
    const receipt = createMutationReceipt()
    const created = await createBookmark(instance.db, bookmark(), receipt)
    expect(created?.id).toBeGreaterThan(0)
    expect(receipt.data_version).toBe(version(instance))
    expect(receipt.data_version).not.toBe('v0')

    const before = version(instance)
    const missing = createMutationReceipt()
    expect(await createBookmark(instance.db, bookmark({ category_id: 999 }), missing)).toBeNull()
    expect(missing.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('collapses the icon trigger bump into the single committed version on update', async () => {
    const instance = database()
    const created = (await createBookmark(instance.db, bookmark()))!
    const receipt = createMutationReceipt()
    // Changing the icon fires bookmark_icon_publish inside the same transaction.
    await updateBookmark(instance.db, created.id, bookmark({ icon: 'https://example.com/b.svg' }), receipt)
    expect(receipt.data_version).toBe(version(instance))

    const missing = createMutationReceipt()
    const before = version(instance)
    expect(await updateBookmark(instance.db, 999, bookmark(), missing)).toBeNull()
    expect(missing.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('bumps on delete only when the row existed', async () => {
    const instance = database()
    const created = (await createBookmark(instance.db, bookmark()))!
    const missing = createMutationReceipt()
    const before = version(instance)
    expect(await deleteBookmark(instance.db, 999, missing)).toBe(false)
    expect(missing.data_version).toBeNull()
    expect(version(instance)).toBe(before)

    const receipt = createMutationReceipt()
    expect(await deleteBookmark(instance.db, created.id, receipt)).toBe(true)
    expect(receipt.data_version).toBe(version(instance))
  })

  it('deletes large batches with chunked IN statements and one shared version', async () => {
    const instance = database()
    const ids: number[] = []
    for (let index = 0; index < 5; index++) ids.push((await createBookmark(instance.db, bookmark({ title: `B${index}` })))!.id)
    instance.statements.length = 0
    const requested = [...ids, ...Array.from({ length: 200 }, (_, index) => 10_000 + index)]
    const receipt = createMutationReceipt()
    expect(await batchDeleteBookmarks(instance.db, requested, receipt)).toBe(5)
    const deletes = instance.statements.filter((sql) => sql.startsWith('DELETE FROM bookmarks'))
    // The sqlite helper records both prepare() and bind() of each statement.
    expect(deletes.length / 2).toBe(Math.ceil(requested.length / 90))
    expect(deletes.every((sql) => sql.includes('WHERE id IN ('))).toBe(true)
    expect(receipt.data_version).toBe(version(instance))

    const none = createMutationReceipt()
    const before = version(instance)
    expect(await batchDeleteBookmarks(instance.db, [20_000, 20_001], none)).toBe(0)
    expect(none.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('rolls back the version together with a failing business statement', async () => {
    const instance = database()
    const before = version(instance)
    const receipt = createMutationReceipt()
    await expect(commitMutation(instance.db, [
      instance.db.prepare("INSERT INTO categories(id,title,sort,created_at) VALUES(50,'Ok',0,1)"),
      instance.db.prepare('INSERT INTO categories(id,title,sort,created_at) VALUES(50,NULL,0,1)'),
    ], receipt)).rejects.toThrow()
    expect(version(instance)).toBe(before)
    expect(receipt.data_version).toBeNull()
    expect(instance.sqlite.prepare('SELECT COUNT(*) AS n FROM categories WHERE id = 50').get()).toEqual({ n: 0 })
  })

  it('keeps category mutations, guards and counts consistent', async () => {
    const instance = database()
    const created = createMutationReceipt()
    const child = await createCategory(instance.db, { title: 'Child', parent_id: 1 }, created)
    expect(created.data_version).toBe(version(instance))

    const updated = createMutationReceipt()
    await updateCategory(instance.db, child.id, { title: 'Child', icon: 'https://example.com/c.svg' }, updated)
    expect(updated.data_version).toBe(version(instance))

    await createBookmark(instance.db, bookmark({ category_id: child.id }))
    const batch = createMutationReceipt()
    expect(await batchDeleteCategories(instance.db, [child.id, 777], batch)).toEqual({ deleted: 1, deleted_bookmarks: 1 })
    expect(batch.data_version).toBe(version(instance))

    const missing = createMutationReceipt()
    const before = version(instance)
    expect(await deleteCategory(instance.db, 888, missing)).toBe(false)
    expect(await batchDeleteCategories(instance.db, [888], missing)).toEqual({ deleted: 0, deleted_bookmarks: 0 })
    expect(missing.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('commits sort chunks with the bump', async () => {
    const instance = database()
    const a = (await createBookmark(instance.db, bookmark({ title: 'A' })))!
    const b = (await createBookmark(instance.db, bookmark({ title: 'B' })))!
    const receipt = createMutationReceipt()
    await sortBookmarks(instance.db, [b.id, a.id], receipt)
    expect(receipt.data_version).toBe(version(instance))
    expect(instance.sqlite.prepare('SELECT id FROM bookmarks ORDER BY sort').all()).toEqual([{ id: b.id }, { id: a.id }])
  })

  it('publishes explicit icon refreshes, including the first known digest, but not anonymous writes', async () => {
    const instance = database()
    const created = (await createBookmark(instance.db, bookmark()))!

    // Anonymous proxy / copy protocol: unknown → known digest stays unpublished (existing contract).
    const anonymousBefore = version(instance)
    expect(await setIconBlob(instance.db, created.id, iconFixture().dataUri, (await getBookmarkIconData(instance.db, created.id))!)).toBe(true)
    expect(version(instance)).toBe(anonymousBefore)

    const second = (await createBookmark(instance.db, bookmark({ title: 'Second' })))!
    const receipt = createMutationReceipt()
    expect(await setIconBlob(instance.db, second.id, iconFixture().dataUri, (await getBookmarkIconData(instance.db, second.id))!, receipt)).toBe(true)
    expect(receipt.data_version).toBe(version(instance))

    // Same bytes in another encoding: no observable change, no bump.
    const same = createMutationReceipt()
    const ready = (await getBookmarkIconData(instance.db, second.id))!
    const percentEncoded = 'data:image/svg+xml,' + encodeURIComponent(new TextDecoder().decode(iconFixture().bytes))
    const before = version(instance)
    expect(await setIconBlob(instance.db, second.id, percentEncoded, ready, same)).toBe(true)
    expect(same.data_version).toBeNull()
    expect(version(instance)).toBe(before)

    // A lost conditional write must not bump either.
    const stale = createMutationReceipt()
    expect(await setIconBlob(instance.db, second.id, iconFixture('blue').dataUri, { ...ready, icon_write_epoch: -1 }, stale)).toBe(false)
    expect(stale.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('writes settings, the optional sync category and the bump atomically, returning settings from the same batch', async () => {
    const instance = database()
    const receipt = createMutationReceipt()
    const settings = await updateSettings(instance.db, { site_title: 'Atomic' }, {
      receipt,
      extraStatements: [ensureBrowserSyncCategoryStatement(instance.db)],
    })
    expect(settings.site_title).toBe('Atomic')
    expect(receipt.data_version).toBe(version(instance))
    const syncCategories = () => instance.sqlite.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id IS NULL AND title = '浏览器新增收藏'").get()
    expect(syncCategories()).toEqual({ n: 1 })

    await writeSettingsPatch(instance.db, { site_title: 'Again' }, { extraStatements: [ensureBrowserSyncCategoryStatement(instance.db)] })
    expect(syncCategories()).toEqual({ n: 1 })

    const empty = createMutationReceipt()
    const before = version(instance)
    await writeSettingsPatch(instance.db, {}, { receipt: empty })
    expect(empty.data_version).toBeNull()
    expect(version(instance)).toBe(before)
  })

  it('reports the import version', async () => {
    const instance = database()
    const receipt = createMutationReceipt()
    await importData(instance.db, { categories: [], bookmarks: [] }, receipt)
    expect(receipt.data_version).toBe(version(instance))
  })

  it('treats any guarded bump of one mutation as the same version', async () => {
    const instance = database()
    const receipt = createMutationReceipt()
    const mutation = new Mutation(instance.db)
      .bump({ sql: '0', params: [] })
      .add(instance.db.prepare("INSERT INTO categories(title,sort,created_at) VALUES('X',0,1)"))
      .bump({ sql: '1', params: [] })
    await mutation.commit(receipt)
    expect(receipt.data_version).toBe(mutation.version)
    expect(version(instance)).toBe(mutation.version)
  })
})

describe('mutationJson', () => {
  const deleted: string[] = []
  beforeEach(() => {
    deleted.length = 0
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { default: { delete: vi.fn(async (request: Request) => { deleted.push(new URL(request.url).pathname); return true }) } },
    })
  })

  function app(dataVersion: string | null, siteConfig = false) {
    const hono = new Hono<HonoEnv>()
    hono.post('/api/thing', (c) => mutationJson(c, { ok: 1 }, { data_version: dataVersion }, { siteConfig }))
    return hono
  }

  it('adds data_version to the envelope and invalidates caches when the version moved', async () => {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }
    const response = await app('v9', true).request('https://navs.example.test/api/thing', { method: 'POST' }, {}, ctx as never)
    expect(await response.json()).toEqual({ code: 0, msg: 'ok', data: { ok: 1 }, data_version: 'v9' })
    expect(deleted.sort()).toEqual(['/api/config', '/api/public/data'])
  })

  it('omits the field and keeps caches when nothing was written', async () => {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }
    const response = await app(null, true).request('https://navs.example.test/api/thing', { method: 'POST' }, {}, ctx as never)
    expect(await response.json()).toEqual({ code: 0, msg: 'ok', data: { ok: 1 } })
    expect(deleted).toEqual([])
  })
})
