import type { IconDataMetadata } from '../../../shared/iconDescriptor'
import { iconMetadataFromRows } from '../iconMetadata'
// settings 聚合读取、单键读写、data_version 维护与部分更新

import { type Settings, type SiteConfig } from '../../../shared/types'
import {
  DEFAULT_SETTINGS,
  readRawSettingsRows,
  settingsFromRawMap,
} from '../settingsData'
import { SETTINGS_LIST_SQL, DATA_VERSION_KEY } from './sql'
import { buildSettingsPatchParams } from './settingsHelpers'
import { Mutation, commitMutation, type MutationReceipt } from './mutation'

async function readRawSettings(db: D1Database): Promise<Map<string, unknown>> {
  const { results } = await db.prepare(SETTINGS_LIST_SQL).all<{ key: string; value: string | null }>()
  return readRawSettingsRows(results ?? [])
}

// 聚合成强类型 Settings（缺失字段回退默认值）
export async function getSettings(db: D1Database): Promise<Settings> {
  return settingsFromRawMap(await readRawSettings(db))
}

export async function getSiteConfig(db: D1Database): Promise<SiteConfig> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('site_title', 'public_mode')")
    .all<{ key: string; value: string | null }>()

  return siteConfigFromRows(results ?? [])
}

// `/api/data/version` 是每次页面加载都会走的热路径，之前它先 getSiteConfig 再
// getDataVersion，两条串行的 D1 往返读的都是 settings 表。合并成一条。
export async function getSiteConfigWithDataVersion(
  db: D1Database,
): Promise<{ config: SiteConfig; version: string } & IconDataMetadata> {
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN ('site_title', 'public_mode', '${DATA_VERSION_KEY}', 'icon_dataset_epoch', 'icon_epoch')`)
    .all<{ key: string; value: string | null }>()

  const rows = results ?? []
  return {
    ...iconMetadataFromRows(rows),
    config: siteConfigFromRows(rows),
    version: dataVersionFromValue(rows.find((row) => row.key === DATA_VERSION_KEY)?.value ?? null),
  }
}

function siteConfigFromRows(rows: Array<{ key: string; value: string | null }>): SiteConfig {
  const config: SiteConfig = {
    site_title: DEFAULT_SETTINGS.site_title,
    public_mode: DEFAULT_SETTINGS.public_mode,
  }

  for (const row of rows) {
    if (row.value == null) continue

    try {
      const value = JSON.parse(row.value) as unknown
      if (row.key === 'site_title' && typeof value === 'string') {
        config.site_title = value
      } else if (row.key === 'public_mode' && typeof value === 'boolean') {
        config.public_mode = value
      }
    } catch {
      if (row.key === 'site_title') config.site_title = row.value
    }
  }

  return config
}

export async function getSettingValues<T = unknown>(
  db: D1Database,
  keys: string[],
): Promise<Map<string, T | null>> {
  if (keys.length === 0) return new Map()

  const placeholders = keys.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string | null }>()

  const values = new Map<string, T | null>()
  for (const row of results ?? []) {
    if (row.value == null) {
      values.set(row.key, null)
      continue
    }

    try {
      values.set(row.key, JSON.parse(row.value) as T)
    } catch {
      values.set(row.key, row.value as unknown as T)
    }
  }

  return values
}

// 写入任意单个内部 key（value 会被 JSON.stringify）
export async function setSettingValue(db: D1Database, key: string, value: unknown): Promise<void> {
  await setSettingValues(db, [[key, value]])
}

/**
 * 一条多行 upsert 写入多个内部 key：单条语句天然原子，且只有一次 D1 往返。
 * 用于管理员凭据引导（多键同时生效）和「改密码 + 轮换 JWT 密钥」这类必须同生共死的写入。
 */
export async function setSettingValues(
  db: D1Database,
  entries: ReadonlyArray<readonly [key: string, value: unknown]>,
): Promise<void> {
  if (entries.length === 0) return
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES ${entries.map(() => '(?, ?)').join(', ')}
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(...entries.flatMap(([key, value]) => [key, JSON.stringify(value)]))
    .run()
}

export function dataVersionFromValue(raw: string | null): string {
  if (!raw) return '0'

  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string' && parsed) return parsed
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return String(parsed)
  } catch {
    return raw
  }

  return '0'
}

export function settingsPatchStatement(db: D1Database, patch: Partial<Settings>): D1PreparedStatement | null {
  const built = buildSettingsPatchParams(patch)
  if (!built) return null

  return db
    .prepare(`INSERT INTO settings (key, value) VALUES ${built.placeholders}
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(...built.params)
}

export interface SettingsWriteOptions {
  /** 同一 batch 里幂等创建「浏览器新增收藏」根分类（开启浏览器同步时）。 */
  extraStatements?: D1PreparedStatement[]
  receipt?: MutationReceipt
}

// 部分更新 Settings（只更新传入的 key）：写入、data_version 提升与回读全量放在同一个 batch。
export async function updateSettings(
  db: D1Database,
  patch: Partial<Settings>,
  options: SettingsWriteOptions = {},
): Promise<Settings> {
  const mutation = new Mutation(db).add(...writeStatements(db, patch, options))
  if (!mutation.hasWrites) return await getSettings(db)
  const results = await mutation.bump().add(db.prepare(SETTINGS_LIST_SQL)).commit(options.receipt)
  const rows = (results.at(-1)?.results ?? []) as Array<{ key: string; value: string | null }>
  return settingsFromRawMap(readRawSettingsRows(rows))
}

export async function writeSettingsPatch(
  db: D1Database,
  patch: Partial<Settings>,
  options: SettingsWriteOptions = {},
): Promise<void> {
  const statements = writeStatements(db, patch, options)
  if (statements.length === 0) return
  await commitMutation(db, statements, options.receipt)
}

function writeStatements(db: D1Database, patch: Partial<Settings>, options: SettingsWriteOptions): D1PreparedStatement[] {
  const statement = settingsPatchStatement(db, patch)
  return [...(options.extraStatements ?? []), ...(statement ? [statement] : [])]
}
