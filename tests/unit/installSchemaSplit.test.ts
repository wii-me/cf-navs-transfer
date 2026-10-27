import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'

vi.mock('../../schema.sql', async () => {
  const { readFileSync: read } = await import('node:fs')
  return { default: read(new URL('../../schema.sql', import.meta.url), 'utf8') }
})

import { initializeSchema, splitSqlStatements } from '../../worker/lib/installSchema'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const TRIGGERS = [
  'bookmark_icon_legacy_body',
  'bookmark_icon_legacy_source',
  'bookmark_icon_publish',
  'category_icon_legacy_body',
  'category_icon_legacy_source',
  'category_icon_publish',
  'bookmark_icon_epoch_insert',
  'bookmark_icon_epoch_delete',
  'bookmark_icon_epoch_update',
  'category_icon_epoch_insert',
  'category_icon_epoch_delete',
  'category_icon_epoch_update',
]

const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close() })

describe('splitSqlStatements', () => {
  it('keeps every CREATE TRIGGER in schema.sql as one complete statement', () => {
    const statements = splitSqlStatements(schema)
    const triggers = statements.filter((sql) => /^CREATE TRIGGER/i.test(sql))
    expect(triggers.map((sql) => /^CREATE TRIGGER IF NOT EXISTS (\w+)/i.exec(sql)?.[1])).toEqual(TRIGGERS)
    for (const sql of triggers) {
      expect(sql).toMatch(/\bBEGIN\b[\s\S]*;\s*END$/i)
    }
    // 没有被切出来的孤立 END / 触发器体片段。
    expect(statements.some((sql) => /^END$/i.test(sql))).toBe(false)
    expect(statements.every((sql) => !/^(UPDATE|INSERT OR REPLACE)\b/i.test(sql))).toBe(true)
  })

  it('handles BEGIN/END/CASE case-insensitively and ignores semicolons in strings, quoted identifiers and comments', () => {
    const sql = `
      create table t (a text, "b;c" text); -- trailing; comment
      /* block; comment with END; */
      create temp trigger tr after insert on t begin
        insert into t (a) values ('x;END;y');
        update t set a = case when new.a = 'end' then 'z;' else new.a end where rowid = new.rowid;
      End;
      Create Trigger tr2 after delete on t BEGIN select [weird;name] from t; END;
      SELECT 'it''s; fine' AS v
    `
    const statements = splitSqlStatements(sql)
    expect(statements).toHaveLength(4)
    expect(statements[0]).toBe('create table t (a text, "b;c" text)')
    expect(statements[1]).toMatch(/^create temp trigger tr[\s\S]*end where rowid = new\.rowid;\s*End$/)
    expect(statements[1]).toContain("'x;END;y'")
    expect(statements[2]).toBe('Create Trigger tr2 after delete on t BEGIN select [weird;name] from t; END')
    expect(statements[3]).toBe("SELECT 'it''s; fine' AS v")
    // 每条都能被真实 SQLite 独立编译。
    const instance = createSqliteD1('CREATE TABLE "weird;name" (x)')
    open.push(instance)
    instance.sqlite.exec('DROP TABLE "weird;name"')
    instance.sqlite.exec('CREATE TABLE t (a text, "b;c" text, [weird;name] text)')
    for (const statement of statements.slice(1)) instance.sqlite.exec(statement)
  })

  it('does not treat identifiers containing begin/end as block keywords', () => {
    const statements = splitSqlStatements('CREATE TRIGGER x AFTER UPDATE OF ended ON t BEGIN UPDATE t SET begin_at = 1, end_at = 2; END; SELECT 1;')
    expect(statements).toEqual([
      'CREATE TRIGGER x AFTER UPDATE OF ended ON t BEGIN UPDATE t SET begin_at = 1, end_at = 2; END',
      'SELECT 1',
    ])
  })
})

describe('initializeSchema with the whole schema.sql', () => {
  it('installs on real SQLite, creates all triggers and they fire', async () => {
    const instance = createSqliteD1('')
    open.push(instance)
    await initializeSchema(instance.db)

    const names = (instance.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
    expect(names).toEqual([...TRIGGERS].sort())

    instance.sqlite.exec("INSERT INTO categories (id, title, sort, created_at) VALUES (1, 'Root', 0, 1)")
    instance.sqlite.exec("INSERT INTO bookmarks (id, category_id, title, url, sort, created_at) VALUES (1, 1, 'A', 'https://a.example', 0, 1)")
    const dataVersion = () => (instance.sqlite.prepare("SELECT value FROM settings WHERE key = 'data_version'").get() as { value: string } | undefined)?.value

    // bookmark_icon_publish：换图标源即刷新 data_version。
    const before = dataVersion()
    instance.sqlite.exec("UPDATE bookmarks SET icon = 'https://a.example/favicon.ico' WHERE id = 1")
    const afterBookmark = dataVersion()
    expect(afterBookmark).toMatch(/^"[0-9a-f]{32}"$/)
    expect(afterBookmark).not.toBe(before)

    // bookmark_icon_legacy_body：旧代码直接改 icon_blob（不动版本列）时作废版本并推进 write_epoch。
    const epoch = (instance.sqlite.prepare('SELECT icon_write_epoch AS e FROM bookmarks WHERE id = 1').get() as { e: number }).e
    instance.sqlite.exec("UPDATE bookmarks SET icon_blob = 'data:image/png;base64,AAAA' WHERE id = 1")
    expect(instance.sqlite.prepare('SELECT icon_revision AS r, icon_write_epoch AS e FROM bookmarks WHERE id = 1').get()).toEqual({ r: null, e: epoch + 1 })

    // category_icon_publish：分类图标变化同样刷新 data_version。
    instance.sqlite.exec("UPDATE categories SET icon = 'mdi:home' WHERE id = 1")
    expect(dataVersion()).not.toBe(afterBookmark)
  })
})
