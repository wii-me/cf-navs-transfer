import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'

// 安装器喂完整 schema.sql（含 6 个 CREATE TRIGGER … BEGIN … END）。
vi.mock('../../schema.sql', async () => {
  const { readFileSync: read } = await import('node:fs')
  return { default: read(new URL('../../schema.sql', import.meta.url), 'utf8') }
})

import { LATEST_SCHEMA_VERSION, SCHEMA_STEPS, ensureSchema, migrateSchema, readSchemaVersion } from '../../worker/lib/db/schema'
import { initializeSchema } from '../../worker/lib/installSchema'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
// v0.8.3 的 schema.sql 与当前相比只少 click_rate_limits（见 git diff v0.8.3 -- schema.sql）。
const v083Schema = schema.replace(/-- 公开点击计数限流[\s\S]*?idx_click_rate_limits_reset ON click_rate_limits\(reset_at\);\n/, '')
// 更早的库：分类无层级 / 私密 / 图标缓存列，书签无图标版本列，也没有触发器。
const ancientSchema = `
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, icon TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, icon TEXT, description TEXT, open_method INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO settings (key, value) VALUES ('site_title', '"Old"');
INSERT INTO categories (id, title, sort, created_at) VALUES (1, 'Root', 0, 1);
INSERT INTO bookmarks (id, category_id, title, url, sort, created_at) VALUES (1, 1, 'A', 'https://a.example', 0, 1);
`

const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => { for (const item of open.splice(0)) item.close() })

function database(source: string) {
  const instance = createSqliteD1(source)
  open.push(instance)
  return instance
}

function storedVersion(instance: ReturnType<typeof createSqliteD1>) {
  const row = instance.sqlite.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as { value: string } | undefined
  return row ? Number(row.value) : null
}

function columns(instance: ReturnType<typeof createSqliteD1>, table: string) {
  return (instance.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
}

function hasTable(instance: ReturnType<typeof createSqliteD1>, name: string) {
  return instance.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null
}

const isDdl = (sql: string) => /^\s*(ALTER|CREATE|INSERT|PRAGMA)\b/i.test(sql)

describe('versioned schema migrations', () => {
  it('numbers steps consecutively from 1', () => {
    expect(SCHEMA_STEPS.map((step) => step.version)).toEqual(SCHEMA_STEPS.map((_, index) => index + 1))
    expect(LATEST_SCHEMA_VERSION).toBe(SCHEMA_STEPS.length)
  })

  it('fresh install through the installer records the latest version', async () => {
    const instance = database('')
    await initializeSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(hasTable(instance, 'click_rate_limits')).toBe(true)
    // 全新库上不应有任何 ALTER（schema.sql 已含全部列）。
    expect(instance.statements.some((sql) => sql.startsWith('ALTER'))).toBe(false)
    // 触发器由 schema.sql 本身建好（不靠迁移补齐）：安装 batch 中即包含完整的 CREATE TRIGGER。
    // （之后的修复模式 ensureSchema 会幂等重跑第 2 步，故只看首条 schema_version 语句之前的安装 batch。）
    const installBatch = instance.statements.slice(0, instance.statements.findIndex((sql) => sql.includes('schema_version')))
    expect(installBatch.filter((sql) => /^CREATE TRIGGER/i.test(sql) && /\bEND$/i.test(sql))).toHaveLength(12)
    expect(instance.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'").get()).toEqual({ n: 12 })
  })

  it('fresh install from the full schema.sql (db:init) reaches the latest version without ALTER', async () => {
    const instance = database(schema)
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(instance.statements.some((sql) => sql.startsWith('ALTER'))).toBe(false)
  })

  it('upgrades a v0.8.3 database without a version row', async () => {
    const instance = database(v083Schema)
    instance.sqlite.exec("INSERT INTO categories (id, title, sort, created_at) VALUES (1, 'Root', 0, 1)")
    expect(hasTable(instance, 'click_rate_limits')).toBe(false)
    expect(storedVersion(instance)).toBeNull()
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(hasTable(instance, 'click_rate_limits')).toBe(true)
    expect(instance.sqlite.prepare('SELECT title FROM categories').all()).toEqual([{ title: 'Root' }])
  })

  it('upgrades an older schema through every step, keeping data and settings', async () => {
    const instance = database(ancientSchema)
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(columns(instance, 'categories')).toEqual(expect.arrayContaining(['parent_id', 'is_private', 'icon_blob', 'icon_revision', 'icon_write_epoch']))
    expect(columns(instance, 'bookmarks')).toEqual(expect.arrayContaining(['icon_source', 'icon_blob', 'icon_background_color', 'description_mode', 'is_private', 'click_count', 'icon_revision', 'icon_write_epoch']))
    expect(instance.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'").get()).toEqual({ n: 12 })
    expect(instance.sqlite.prepare("SELECT value FROM settings WHERE key = 'site_title'").get()).toEqual({ value: '"Old"' })
    expect(instance.sqlite.prepare("SELECT 1 FROM settings WHERE key = 'icon_dataset_epoch'").get()).toBeTruthy()
    expect(instance.sqlite.prepare('SELECT title, click_count FROM bookmarks').all()).toEqual([{ title: 'A', click_count: 0 }])
  })

  it('is idempotent when rerun, including the forced repair path', async () => {
    const instance = database(ancientSchema)
    await ensureSchema(instance.db)
    const before = columns(instance, 'bookmarks')
    await ensureSchema(instance.db, true)
    expect(await migrateSchema(instance.db, true)).toBe('migrated')
    expect(columns(instance, 'bookmarks')).toEqual(before)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('executes no DDL when the stored version is current', async () => {
    const instance = database(schema)
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)

    // 新 isolate：只读一次版本号。
    instance.statements.length = 0
    expect(await migrateSchema(instance.db)).toBe('current')
    expect(instance.statements).toEqual(["SELECT value FROM settings WHERE key = 'schema_version'"])

    // 同一 isolate 再次调用：一条语句都不发。
    instance.statements.length = 0
    await ensureSchema(instance.db)
    expect(instance.statements).toEqual([])
  })

  it('shares one run between concurrent first requests in an isolate', async () => {
    const instance = database(ancientSchema)
    await Promise.all(Array.from({ length: 5 }, () => ensureSchema(instance.db)))
    expect(instance.statements.filter((sql) => sql === "SELECT value FROM settings WHERE key = 'schema_version'")).toHaveLength(1)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('tolerates another isolate migrating the same database concurrently', async () => {
    const instance = database(ancientSchema)
    // 两次独立的 migrateSchema 模拟两个 isolate：都读到旧版本、都 PRAGMA 到缺列，
    // 后提交的一方撞上 duplicate column 后重算该步。
    const results = await Promise.all([migrateSchema(instance.db), migrateSchema(instance.db)])
    expect(results).toEqual(['migrated', 'migrated'])
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(columns(instance, 'categories').filter((name) => name === 'parent_id')).toHaveLength(1)
  })

  it('never lowers a newer stored version', async () => {
    const instance = database(schema)
    instance.sqlite.exec(`INSERT INTO settings (key, value) VALUES ('schema_version', '${LATEST_SCHEMA_VERSION + 5}')`)
    instance.statements.length = 0
    expect(await migrateSchema(instance.db)).toBe('current')
    expect(instance.statements.filter(isDdl)).toEqual([])
    await migrateSchema(instance.db, true)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION + 5)
  })

  it('does not bump the version when a step fails midway and retries on the next request', async () => {
    const instance = database(ancientSchema)
    const batch = instance.db.batch.bind(instance.db)
    let fail = true
    instance.db.batch = (async (statements: D1PreparedStatement[]) => {
      const sqls = (statements as unknown as Array<{ sql: string }>).map((statement) => statement.sql)
      // 第 2 步：在其 DDL 之后、版本写入之前插入一条必然失败的语句。
      if (fail && sqls.some((sql) => sql.includes('icon_write_epoch'))) {
        const failing = instance.db.prepare('INSERT INTO missing_table_for_test VALUES (1)')
        return batch([...statements.slice(0, -1), failing, statements[statements.length - 1]])
      }
      return batch(statements)
    }) as typeof instance.db.batch

    await expect(ensureSchema(instance.db)).rejects.toThrow(/missing_table_for_test/)
    expect(storedVersion(instance)).toBe(1)
    // 整步回滚：第 2 步加的列不存在，第 3 步没跑。
    expect(columns(instance, 'bookmarks')).not.toContain('icon_revision')
    expect(hasTable(instance, 'click_rate_limits')).toBe(false)

    fail = false
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
    expect(columns(instance, 'bookmarks')).toContain('icon_revision')
  })

  it('skips an uninstalled database without caching, then migrates once installed', async () => {
    const instance = database('')
    await ensureSchema(instance.db)
    expect(await readSchemaVersion(instance.db)).toBeNull()
    expect(hasTable(instance, 'settings')).toBe(false)

    instance.sqlite.exec(v083Schema)
    await ensureSchema(instance.db)
    expect(storedVersion(instance)).toBe(LATEST_SCHEMA_VERSION)
  })
})
