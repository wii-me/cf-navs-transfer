import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublicData } from '../../shared/types'
import { toPublicSettings } from '../../shared/settings'
import { DEFAULT_SETTINGS } from '../../worker/lib/settingsData'
import {
  hasSupportedSnapshotSchema,
  readSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotStorageConfig,
  writeSnapshot,
} from '../../src/lib/snapshotStorage'
import { readCachedPublicDataEntry, writeCachedPublicData } from '../../src/lib/publicDataCache'

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length(): number { return this.items.size }
  clear(): void { this.items.clear() }
  getItem(key: string): string | null { return this.items.get(key) ?? null }
  key(index: number): string | null { return Array.from(this.items.keys())[index] ?? null }
  removeItem(key: string): void { this.items.delete(key) }
  setItem(key: string, value: string): void { this.items.set(key, value) }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage, location: { origin: 'https://navs.example.test' } }, configurable: true })
})

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

const config: SnapshotStorageConfig<Record<string, unknown>> = {
  cacheName: 'test-snapshots',
  cachePathPrefix: '/test/',
  storagePrefix: 'test.snap.',
  parse: (value) => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : null),
}

const publicData: PublicData = {
  categories: [{ id: 1, parent_id: null, title: 'Tools', icon: null, sort: 0 }],
  bookmarks: [],
  settings: toPublicSettings(DEFAULT_SETTINGS),
}

function rawEntry(prefix: string): Record<string, unknown> {
  const key = Array.from({ length: storage.length }, (_, i) => storage.key(i)).find((k) => k?.startsWith(prefix))
  expect(key).toBeTruthy()
  return JSON.parse(storage.getItem(key!)!)
}

describe('snapshot schema version', () => {
  it('accepts the current version and legacy payloads without the field', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1)
    expect(hasSupportedSnapshotSchema({ data: {} })).toBe(true)
    expect(hasSupportedSnapshotSchema({ snapshot_schema_version: 1 })).toBe(true)
  })

  it('rejects other versions, wrong types and non-object envelopes', () => {
    expect(hasSupportedSnapshotSchema({ snapshot_schema_version: 2 })).toBe(false)
    expect(hasSupportedSnapshotSchema({ snapshot_schema_version: 0 })).toBe(false)
    expect(hasSupportedSnapshotSchema({ snapshot_schema_version: '1' })).toBe(false)
    expect(hasSupportedSnapshotSchema({ snapshot_schema_version: null })).toBe(false)
    expect(hasSupportedSnapshotSchema(null)).toBe(false)
    expect(hasSupportedSnapshotSchema([])).toBe(false)
    expect(hasSupportedSnapshotSchema('x')).toBe(false)
  })

  it('stamps every written envelope without mutating the caller value', async () => {
    const value = { saved_at: 1, data: { a: 1 } }
    await writeSnapshot(config, 'k', value)
    expect(value).not.toHaveProperty('snapshot_schema_version')
    expect(rawEntry('test.snap.')).toEqual({ saved_at: 1, data: { a: 1 }, snapshot_schema_version: 1 })
    expect(await readSnapshot(config, 'k')).toMatchObject({ data: { a: 1 } })
  })

  it('treats an envelope from another schema version as a cache miss', async () => {
    storage.setItem('test.snap.k', JSON.stringify({ snapshot_schema_version: 2, data: { a: 1 } }))
    expect(await readSnapshot(config, 'k')).toBeNull()
  })

  it('public data cache stamps on write and still reads pre-version snapshots', async () => {
    await writeCachedPublicData(publicData, 'v7')
    const payload = rawEntry('cf-navs.public-data.')
    expect(payload.snapshot_schema_version).toBe(1)

    delete payload.snapshot_schema_version
    const key = storage.key(0)!
    storage.setItem(key, JSON.stringify(payload))
    const legacy = await readCachedPublicDataEntry()
    expect(legacy?.version).toBe('v7')
    expect(legacy?.data.categories[0]?.title).toBe('Tools')

    storage.setItem(key, JSON.stringify({ ...payload, snapshot_schema_version: 99 }))
    expect(await readCachedPublicDataEntry()).toBeNull()
  })
})
