const CACHE_ORIGIN = 'https://cf-navs.local'
export const DEFAULT_MAX_SNAPSHOT_BYTES = 1_500_000

// Envelope version of every persisted data snapshot. Bump it when the payload
// shape changes incompatibly: readers then treat older or newer envelopes as a
// cache miss instead of handing a foreign shape to `parse`. Payloads written
// before the field existed are the version-1 shape and stay readable.
export const SNAPSHOT_SCHEMA_VERSION = 1
const SNAPSHOT_SCHEMA_FIELD = 'snapshot_schema_version'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasSupportedSnapshotSchema(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const version = value[SNAPSHOT_SCHEMA_FIELD]
  return version === undefined || version === SNAPSHOT_SCHEMA_VERSION
}

function parseSnapshot<T>(config: SnapshotStorageConfig<T>, value: unknown): T | null {
  return hasSupportedSnapshotSchema(value) ? config.parse(value) : null
}

function stampSnapshot(value: unknown): unknown {
  return isPlainObject(value) ? { ...value, [SNAPSHOT_SCHEMA_FIELD]: SNAPSHOT_SCHEMA_VERSION } : value
}

export type SnapshotStorageConfig<T> = {
  cacheName: string
  cachePathPrefix: string
  storagePrefix: string
  parse: (value: unknown) => T | null
  maxBytes?: number
}

function canUseCacheStorage(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && 'localStorage' in window
}

export function hashSnapshotScope(input: string): string {
  let value = 0
  for (let index = 0; index < input.length; index += 1) {
    value = Math.imul(31, value) + input.charCodeAt(index) | 0
  }
  return Math.abs(value).toString(36)
}

export function currentSnapshotOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'local'
}

function cacheRequest(cachePathPrefix: string, key: string): Request {
  return new Request(`${CACHE_ORIGIN}${cachePathPrefix}${encodeURIComponent(key)}`, { method: 'GET' })
}

function localStorageKey(storagePrefix: string, key: string): string {
  return `${storagePrefix}${key}`
}

function isCacheRequest(request: Request, cachePathPrefix: string): boolean {
  try {
    const url = new URL(request.url)
    return url.origin === CACHE_ORIGIN && url.pathname.startsWith(cachePathPrefix)
  } catch {
    return false
  }
}

export async function pruneOtherSnapshots<T>(config: SnapshotStorageConfig<T>, key: string, isCurrent: () => boolean = () => true): Promise<void> {
  if (canUseLocalStorage()) {
    const currentKey = localStorageKey(config.storagePrefix, key)
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const candidate = localStorage.key(index)
        if (isCurrent() && candidate?.startsWith(config.storagePrefix) && candidate !== currentKey) localStorage.removeItem(candidate)
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  if (canUseCacheStorage()) {
    try {
      const cache = await caches.open(config.cacheName)
      const currentUrl = cacheRequest(config.cachePathPrefix, key).url
      const requests = await cache.keys()
      await Promise.all(requests.map((request) => (
        isCurrent() && request.url !== currentUrl && isCacheRequest(request, config.cachePathPrefix)
          ? cache.delete(request)
          : Promise.resolve(false)
      )))
    } catch {
      // Best-effort cleanup.
    }
  }
}

// A late write owns one scope, not every snapshot in this browser profile.
export async function removeSnapshot<T>(config: SnapshotStorageConfig<T>, key: string): Promise<void> {
  if (canUseLocalStorage()) {
    try { localStorage.removeItem(localStorageKey(config.storagePrefix, key)) } catch { /* Best-effort cleanup. */ }
  }
  if (canUseCacheStorage()) {
    try {
      const cache = await caches.open(config.cacheName)
      await cache.delete(cacheRequest(config.cachePathPrefix, key))
    } catch { /* Best-effort cleanup. */ }
  }
}

export async function readSnapshot<T>(config: SnapshotStorageConfig<T>, key: string): Promise<T | null> {
  if (canUseLocalStorage()) {
    try {
      const raw = localStorage.getItem(localStorageKey(config.storagePrefix, key))
      if (raw) {
        const parsed = parseSnapshot(config, JSON.parse(raw))
        if (parsed) return parsed
      }
    } catch {
      // Fall through to Cache Storage.
    }
  }

  if (!canUseCacheStorage()) return null
  try {
    const cache = await caches.open(config.cacheName)
    const cached = await cache.match(cacheRequest(config.cachePathPrefix, key))
    return cached ? parseSnapshot(config, await cached.json()) : null
  } catch {
    return null
  }
}

export async function writeSnapshot<T>(config: SnapshotStorageConfig<T>, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(stampSnapshot(value))
  if (serialized.length > (config.maxBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES)) {
    await clearSnapshots(config)
    return
  }

  if (canUseLocalStorage()) {
    try {
      localStorage.setItem(localStorageKey(config.storagePrefix, key), serialized)
      if (canUseCacheStorage()) {
        const cache = await caches.open(config.cacheName)
        await cache.delete(cacheRequest(config.cachePathPrefix, key))
      }
      return
    } catch {
      // Fall back to Cache Storage.
    }
  }

  if (canUseCacheStorage()) {
    try {
      const cache = await caches.open(config.cacheName)
      await cache.put(cacheRequest(config.cachePathPrefix, key), new Response(serialized, {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      }))
    } catch {
      // Browser persistence is best-effort.
    }
  }
}

export async function clearSnapshots<T>(config: SnapshotStorageConfig<T>, isCurrent: () => boolean = () => true): Promise<void> {
  if (isCurrent() && canUseCacheStorage()) {
    try { await caches.delete(config.cacheName) } catch { /* Best-effort cleanup. */ }
  }
  if (canUseLocalStorage()) {
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index)
        if (isCurrent() && key?.startsWith(config.storagePrefix)) localStorage.removeItem(key)
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}
