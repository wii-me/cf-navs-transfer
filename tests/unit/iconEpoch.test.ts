import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import { migrateSchema } from '../../worker/lib/db/schema'
import { ICON_EPOCH_TRIGGERS } from '../../worker/lib/db/iconSchema'
import { iconMetadataFromRows } from '../../worker/lib/iconMetadata'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close() })

function database() {
  const instance = createSqliteD1(schema)
  open.push(instance)
  instance.sqlite.exec("INSERT INTO categories (id, title, sort, created_at) VALUES (1, 'Root', 0, 1)")
  instance.sqlite.exec("INSERT INTO bookmarks (id, category_id, title, url, sort, created_at) VALUES (1, 1, 'A', 'https://a.example', 0, 1)")
  return instance
}

const epoch = (instance: ReturnType<typeof createSqliteD1>) =>
  Number((instance.sqlite.prepare("SELECT value FROM settings WHERE key = 'icon_epoch'").get() as { value: string }).value)

describe('global icon epoch', () => {
  it('schema.sql installs the counter and every trigger', () => {
    const instance = database()
    const names = (instance.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%icon_epoch%'").all() as Array<{ name: string }>).map(row => row.name).sort()
    expect(names).toHaveLength(ICON_EPOCH_TRIGGERS.length)
    expect(epoch(instance)).toBeGreaterThanOrEqual(0)
  })

  it('bumps on icon, visibility, membership and identity changes, not on sort or clicks', () => {
    const instance = database()
    const bumps = (sql: string) => { const before = epoch(instance); instance.sqlite.exec(sql); return epoch(instance) - before }
    expect(bumps("UPDATE bookmarks SET sort = 5, click_count = 9 WHERE id = 1")).toBe(0)
    expect(bumps("UPDATE categories SET sort = 3 WHERE id = 1")).toBe(0)
    expect(bumps("UPDATE bookmarks SET icon = 'https://a.example/x.png' WHERE id = 1")).toBeGreaterThan(0)
    expect(bumps("UPDATE bookmarks SET is_private = 1 WHERE id = 1")).toBeGreaterThan(0)
    expect(bumps("UPDATE bookmarks SET title = 'B' WHERE id = 1")).toBeGreaterThan(0)
    expect(bumps("UPDATE categories SET is_private = 1 WHERE id = 1")).toBeGreaterThan(0)
    expect(bumps("UPDATE categories SET icon = 'mdi:home' WHERE id = 1")).toBeGreaterThan(0)
    expect(bumps("INSERT INTO bookmarks (id, category_id, title, url, sort, created_at) VALUES (2, 1, 'C', 'https://c.example', 1, 1)")).toBeGreaterThan(0)
    expect(bumps("DELETE FROM bookmarks WHERE id = 2")).toBeGreaterThan(0)
    expect(bumps("INSERT INTO categories (id, title, sort, created_at) VALUES (2, 'Child', 1, 1)")).toBeGreaterThan(0)
    expect(bumps("DELETE FROM categories WHERE id = 2")).toBeGreaterThan(0)
  })

  it('a migrated older database gains the counter (repair path re-runs every step)', async () => {
    const instance = database()
    instance.sqlite.exec("DELETE FROM settings WHERE key = 'icon_epoch'")
    for (const name of ['bookmark_icon_epoch_insert', 'bookmark_icon_epoch_delete', 'bookmark_icon_epoch_update', 'category_icon_epoch_insert', 'category_icon_epoch_delete', 'category_icon_epoch_update']) {
      instance.sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`)
    }
    await migrateSchema(instance.db, true)
    expect(epoch(instance)).toBe(0)
    instance.sqlite.exec("UPDATE bookmarks SET icon = 'x' WHERE id = 1")
    expect(epoch(instance)).toBeGreaterThan(0)
  })

  it('parses metadata from settings rows and drops invalid values', () => {
    const dataset = 'a'.repeat(32)
    expect(iconMetadataFromRows([{ key: 'icon_dataset_epoch', value: JSON.stringify(dataset) }, { key: 'icon_epoch', value: '7' }])).toEqual({ dataset_epoch: dataset, icon_epoch: 7 })
    expect(iconMetadataFromRows([{ key: 'icon_dataset_epoch', value: '"bad"' }, { key: 'icon_epoch', value: 'x' }])).toEqual({})
    expect(iconMetadataFromRows([])).toEqual({})
  })
})
