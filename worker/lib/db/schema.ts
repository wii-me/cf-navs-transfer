import { CLICK_RATE_LIMIT_SCHEMA } from './clickRateLimitSchema'
import { BOOKMARK_ICON_TRIGGERS, CATEGORY_ICON_TRIGGERS, ICON_EPOCH_TRIGGERS, INITIALIZE_ICON_DATASET_SQL, INITIALIZE_ICON_EPOCH_SQL } from './iconSchema'

// 版本化 schema 迁移（代码审查三轮第 2 项）。
//
// - 库内版本号存在 settings 表的 `schema_version` 行（JSON 整数；与安装标记
//   `installation_schema_version` 无关）。没有该行的旧库（含 v0.8.3）按版本 0 处理。
// - SCHEMA_STEPS 是有序的迁移步骤，每步幂等（先 PRAGMA 判断缺列才 ALTER，其余为
//   IF NOT EXISTS / OR IGNORE）。每步的 DDL 与版本写入放在同一个 D1 batch（一个事务）：
//   中途失败整步回滚，版本号不前进。
// - 版本写入是单调 upsert（只升不降）：多个 isolate 并发迁移、或回滚部署的旧代码，
//   都不会把版本号改小。并发加列撞上「duplicate column」时重算该步再试一次。
// - 每个 isolate 每个 D1 绑定只跑一次（模块级 promise）；版本已是最新时只有一条
//   单行 SELECT，不执行任何 DDL。未安装（settings 表不存在）时不缓存结果。
// - 新增迁移：在 SCHEMA_STEPS 末尾追加 version = 上一步 + 1 的步骤，并同步 schema.sql。

export const SCHEMA_VERSION_KEY = 'schema_version'

interface SchemaStep {
  version: number
  name: string
  statements(db: D1Database): Promise<D1PreparedStatement[]>
}

async function addMissingColumns(db: D1Database, table: 'bookmarks' | 'categories', columns: Array<[name: string, definition: string]>): Promise<D1PreparedStatement[]> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  const existing = new Set((results ?? []).map((column) => column.name))
  return columns
    .filter(([name]) => !existing.has(name))
    .map(([name, definition]) => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`))
}

export const SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    version: 1,
    name: 'legacy columns and sort indexes',
    async statements(db) {
      return [
        ...await addMissingColumns(db, 'bookmarks', [
          ['icon_source', 'TEXT'],
          ['icon_blob', 'TEXT'],
          ['icon_background_color', 'TEXT'],
          ['description_mode', 'TEXT'],
          ['is_private', 'INTEGER NOT NULL DEFAULT 0'],
          ['click_count', 'INTEGER DEFAULT 0'],
        ]),
        ...await addMissingColumns(db, 'categories', [
          ['parent_id', 'INTEGER'],
          ['is_private', 'INTEGER NOT NULL DEFAULT 0'],
        ]),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_global ON bookmarks(sort, id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_categories_sort_id ON categories(sort, id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_categories_parent_sort_id ON categories(parent_id, sort, id)'),
      ]
    },
  },
  {
    version: 2,
    name: 'versioned icons',
    async statements(db) {
      return [
        ...await addMissingColumns(db, 'bookmarks', [
          ['icon_revision', 'TEXT'],
          ['icon_write_epoch', 'INTEGER NOT NULL DEFAULT 0'],
        ]),
        ...await addMissingColumns(db, 'categories', [
          ['icon_blob', 'TEXT'],
          ['icon_revision', 'TEXT'],
          ['icon_write_epoch', 'INTEGER NOT NULL DEFAULT 0'],
        ]),
        db.prepare(INITIALIZE_ICON_DATASET_SQL),
        ...BOOKMARK_ICON_TRIGGERS.map((sql) => db.prepare(sql)),
        ...CATEGORY_ICON_TRIGGERS.map((sql) => db.prepare(sql)),
      ]
    },
  },
  {
    version: 3,
    name: 'click rate limits',
    async statements(db) {
      return CLICK_RATE_LIMIT_SCHEMA.map((sql) => db.prepare(sql))
    },
  },
  {
    version: 4,
    name: 'global icon epoch',
    async statements(db) {
      return [
        db.prepare(INITIALIZE_ICON_EPOCH_SQL),
        ...ICON_EPOCH_TRIGGERS.map((sql) => db.prepare(sql)),
      ]
    },
  },
]

export const LATEST_SCHEMA_VERSION = SCHEMA_STEPS[SCHEMA_STEPS.length - 1].version

const READ_SCHEMA_VERSION_SQL = `SELECT value FROM settings WHERE key = '${SCHEMA_VERSION_KEY}'`
// 单调写入：只有新值更大时才覆盖（非数字旧值 CAST 为 0）。
const WRITE_SCHEMA_VERSION_SQL = `INSERT INTO settings (key, value) VALUES ('${SCHEMA_VERSION_KEY}', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
  WHERE CAST(settings.value AS INTEGER) < CAST(excluded.value AS INTEGER)`

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).toLowerCase()
}

function isRecoverableSchemaError(error: unknown): boolean {
  const normalized = errorMessage(error)
  return (
    normalized.includes('no such column') ||
    normalized.includes('has no column named') ||
    // 迁移新增的辅助表（如 click_rate_limits）在旧库上缺失。
    normalized.includes('no such table: click_rate_limits')
  )
}

// 另一个 isolate 刚好并发加了同一列 / 建了同一对象。
function isConcurrentDdlError(error: unknown): boolean {
  const normalized = errorMessage(error)
  return normalized.includes('duplicate column name') || normalized.includes('already exists')
}

/** 读库内 schema 版本；settings 表不存在（未安装）返回 null，缺行或非法值按 0。 */
export async function readSchemaVersion(db: D1Database): Promise<number | null> {
  let row: { value: string | null } | null
  try {
    row = await db.prepare(READ_SCHEMA_VERSION_SQL).first<{ value: string | null }>()
  } catch (error) {
    if (errorMessage(error).includes('no such table: settings')) return null
    throw error
  }
  const parsed = Number(row?.value ?? 0)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

async function applyStep(db: D1Database, step: SchemaStep): Promise<void> {
  const run = async () => {
    const statements = await step.statements(db)
    statements.push(db.prepare(WRITE_SCHEMA_VERSION_SQL).bind(String(step.version)))
    await db.batch(statements)
  }
  try {
    await run()
  } catch (error) {
    if (!isConcurrentDdlError(error)) throw error
    // 整步已回滚；重新 PRAGMA 后只剩对方没做的部分。
    await run()
  }
}

type MigrationOutcome = 'current' | 'migrated' | 'not_installed'

/**
 * 执行待跑的迁移步骤。repair=true（缺列错误后的重试路径）时不信任版本号，
 * 所有步骤都幂等地重跑一遍。
 */
export async function migrateSchema(db: D1Database, repair = false): Promise<MigrationOutcome> {
  const current = await readSchemaVersion(db)
  if (current === null) return 'not_installed'
  if (!repair && current >= LATEST_SCHEMA_VERSION) return 'current'
  for (const step of SCHEMA_STEPS) {
    if (repair || step.version > current) await applyStep(db, step)
  }
  return 'migrated'
}

interface SchemaState {
  promise: Promise<void>
  settled: boolean
}

const schemaStates = new WeakMap<D1Database, SchemaState>()

/**
 * 每个 isolate 每个 D1 绑定只迁移一次；并发首请求共享同一个 promise。
 * force=true 在上一次已完成时以修复模式重跑（进行中的则直接复用）。
 * 失败或未安装时不缓存，下一次请求重试。
 */
export function ensureSchema(db: D1Database, force = false): Promise<void> {
  const existing = schemaStates.get(db)
  if (existing && (!existing.settled || !force)) return existing.promise
  const state: SchemaState = { promise: Promise.resolve(), settled: false }
  state.promise = migrateSchema(db, force).then(
    (outcome) => {
      state.settled = true
      if (outcome === 'not_installed' && schemaStates.get(db) === state) schemaStates.delete(db)
    },
    (error: unknown) => {
      if (schemaStates.get(db) === state) schemaStates.delete(db)
      throw error
    },
  )
  schemaStates.set(db, state)
  return state.promise
}

export async function withSchemaRetry<T>(db: D1Database, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isRecoverableSchemaError(error)) throw error
    await ensureSchema(db, true)
    return await operation()
  }
}
