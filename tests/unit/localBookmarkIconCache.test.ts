import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBookmarkIconCacheKey,
  deleteCachedBookmarkIcon,
  fetchAndCacheBookmarkIconUrl,
  fetchCachedBookmarkIconUrl,
  isDataImage,
  readCachedBookmarkIconDataUri,
  readCachedBookmarkIconUrl,
  revokeLocalIconUrl,
  writeBookmarkIconDataUri,
} from '../../src/lib/localBookmarkIconCache'

const STORAGE_PREFIX = 'cf-navs.bookmark-icon.'

class MemoryLocalStorage {
  private values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  clear(): void {
    this.values.clear()
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  keys(): string[] {
    return Array.from(this.values.keys())
  }
}

function storageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`
}

function setupLocalStorage() {
  const localStorage = new MemoryLocalStorage()
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('window', { localStorage })
  return localStorage
}

function setupCacheStorage() {
  const localStorage = setupLocalStorage()
  const entries = new Map<string, Response>()
  const cache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    keys: async () => [],
    put: async (request: Request, response: Response) => {
      entries.set(request.url, response.clone())
    },
    delete: async (request: Request) => entries.delete(request.url),
  }
  const caches = { open: vi.fn(async () => cache) }

  vi.stubGlobal('caches', caches)
  vi.stubGlobal('window', { localStorage, caches })
  const testUrl = class extends URL { }
  Object.assign(testUrl, {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  })
  vi.stubGlobal('URL', testUrl)
  return entries
}

describe('local bookmark icon cache', () => {
  beforeEach(() => {
    setupLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates stable cache keys that change with icon inputs', () => {
    const input = { id: 7, icon: 'https://example.com/icon.png', iconSource: 'custom' }

    expect(createBookmarkIconCacheKey(input)).toBe(createBookmarkIconCacheKey(input))
    expect(createBookmarkIconCacheKey(input)).not.toBe(createBookmarkIconCacheKey({
      ...input,
      icon: 'https://example.com/other.png',
    }))
    expect(createBookmarkIconCacheKey(input)).not.toBe(createBookmarkIconCacheKey({
      ...input,
      iconSource: 'google',
    }))
  })

  it('recognizes only image data URIs', () => {
    expect(isDataImage(' data:image/png;base64,abc ')).toBe(true)
    expect(isDataImage('data:image/svg+xml,<svg></svg>')).toBe(true)
    expect(isDataImage('data:text/plain,abc')).toBe(false)
    expect(isDataImage('https://example.com/icon.png')).toBe(false)
  })

  it('writes and reads cached data URIs through localStorage', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 1, icon: 'data:image/png;base64,a', iconSource: 'custom' })

    await writeBookmarkIconDataUri(cacheKey, 'data:image/png;base64,a')

    expect(readCachedBookmarkIconDataUri(cacheKey)).toBe('data:image/png;base64,a')
    await expect(readCachedBookmarkIconUrl(cacheKey)).resolves.toBe('data:image/png;base64,a')
  })

  it('ignores non-image data URIs', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 1, icon: 'data:text/plain,a', iconSource: 'custom' })

    await writeBookmarkIconDataUri(cacheKey, 'data:text/plain,a')

    expect(readCachedBookmarkIconDataUri(cacheKey)).toBeNull()
  })

  it('removes stale localStorage entries for the same bookmark id', async () => {
    const localStorage = setupLocalStorage()
    const firstKey = createBookmarkIconCacheKey({ id: 9, icon: 'data:image/png;base64,old', iconSource: 'custom' })
    const secondKey = createBookmarkIconCacheKey({ id: 9, icon: 'data:image/png;base64,new', iconSource: 'custom' })

    await writeBookmarkIconDataUri(firstKey, 'data:image/png;base64,old')
    await writeBookmarkIconDataUri(secondKey, 'data:image/png;base64,new')

    expect(localStorage.getItem(storageKey(firstKey))).toBeNull()
    expect(localStorage.getItem(storageKey(secondKey))).toBe('data:image/png;base64,new')
    expect(localStorage.keys().filter((key) => key.startsWith(`${STORAGE_PREFIX}9-`))).toHaveLength(1)
  })

  it('deletes cached localStorage entries and degrades without Cache Storage', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 3, icon: 'data:image/png;base64,a', iconSource: 'custom' })

    await writeBookmarkIconDataUri(cacheKey, 'data:image/png;base64,a')
    await deleteCachedBookmarkIcon(cacheKey)

    expect(readCachedBookmarkIconDataUri(cacheKey)).toBeNull()
    await expect(readCachedBookmarkIconUrl('missing-cache-key')).resolves.toBeNull()
  })

  it('persists fetched remote icons in Cache Storage for later browser sessions', async () => {
    const entries = setupCacheStorage()
    vi.stubGlobal('fetch', vi.fn(async () => {
      const response = new Response('<svg/>', {
        headers: { 'content-type': 'image/svg+xml', 'content-length': '6' },
      })
      return response
    }))
    const cacheKey = createBookmarkIconCacheKey({ id: 4, icon: 'https://example.com/icon.svg', iconSource: 'custom' })

    const firstUrl = await fetchAndCacheBookmarkIconUrl(cacheKey, '/api/icon/4?v=stable')
    const reopenedUrl = await readCachedBookmarkIconUrl(cacheKey)

    expect(firstUrl).toMatch(/^blob:/)
    expect(reopenedUrl).toMatch(/^blob:/)
    expect(entries.size).toBe(1)
    if (firstUrl) revokeLocalIconUrl(firstUrl)
    if (reopenedUrl) revokeLocalIconUrl(reopenedUrl)
  })

  it('does not persist fallback, no-store, or oversized icon responses', async () => {
    const entries = setupCacheStorage()
    const responses = [
      new Response('<svg/>', {
        headers: { 'content-type': 'image/svg+xml', 'X-Icon-Fallback': '1' },
      }),
      new Response('<svg/>', {
        headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-store' },
      }),
      new Response('<svg/>', {
        headers: {
          'content-type': 'image/svg+xml',
          'content-length': String(512 * 1024 + 1),
        },
      }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!))

    const fallbackUrl = await fetchAndCacheBookmarkIconUrl('4-fallback', '/api/icon/4')
    const privateUrl = await fetchAndCacheBookmarkIconUrl('5-private', '/api/icon/5')
    const oversizedUrl = await fetchAndCacheBookmarkIconUrl('6-oversized', '/api/icon/6')

    expect(fallbackUrl).toMatch(/^blob:/)
    expect(privateUrl).toMatch(/^blob:/)
    expect(oversizedUrl).toMatch(/^blob:/)
    expect(entries.size).toBe(0)
    if (fallbackUrl) revokeLocalIconUrl(fallbackUrl)
    if (privateUrl) revokeLocalIconUrl(privateUrl)
    if (oversizedUrl) revokeLocalIconUrl(oversizedUrl)
  })

  it('deletes stale fallback and no-store entries when reading', async () => {
    const entries = setupCacheStorage()
    entries.set('https://cf-navs.local/bookmark-icon/6-fallback', new Response('<svg/>', {
      headers: { 'content-type': 'image/svg+xml', 'X-Icon-Fallback': '1' },
    }))
    entries.set('https://cf-navs.local/bookmark-icon/7-private', new Response('<svg/>', {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-store' },
    }))

    await expect(readCachedBookmarkIconUrl('6-fallback')).resolves.toBeNull()
    await expect(readCachedBookmarkIconUrl('7-private')).resolves.toBeNull()
    expect(entries.size).toBe(0)
  })
})

describe('fetchCachedBookmarkIconUrl', () => {
  beforeEach(() => {
    setupLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the cached URL and marks it as fresh when no race occurs', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 1, icon: 'data:image/png;base64,a', iconSource: 'custom' })
    await writeBookmarkIconDataUri(cacheKey, 'data:image/png;base64,a')

    const seq = { current: 0 }
    const result = await fetchCachedBookmarkIconUrl(cacheKey, seq)

    expect(result.stale).toBe(false)
    expect(result.url).toBe('data:image/png;base64,a')
    expect(seq.current).toBe(1)
  })

  it('returns stale=true and revokes URL when request counter has changed', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 2, icon: 'data:image/png;base64,b', iconSource: 'custom' })
    await writeBookmarkIconDataUri(cacheKey, 'data:image/png;base64,b')

    const seq = { current: 0 }

    // Simulate a race: start fetch, then change seq externally
    const fetchPromise = fetchCachedBookmarkIconUrl(cacheKey, seq)
    seq.current = 999  // Simulate a newer request invalidating this one

    const result = await fetchPromise

    expect(result.stale).toBe(true)
    expect(result.url).toBeNull()
  })

  it('returns url=null, stale=false when no cache entry exists and request is fresh', async () => {
    const seq = { current: 0 }
    const result = await fetchCachedBookmarkIconUrl('nonexistent-key', seq)

    expect(result.stale).toBe(false)
    expect(result.url).toBeNull()
    expect(seq.current).toBe(1)
  })

  it('increments the request sequence counter', async () => {
    const cacheKey = createBookmarkIconCacheKey({ id: 3, icon: 'data:image/png;base64,c', iconSource: 'custom' })
    await writeBookmarkIconDataUri(cacheKey, 'data:image/png;base64,c')

    const seq = { current: 5 }
    await fetchCachedBookmarkIconUrl(cacheKey, seq)

    expect(seq.current).toBe(6)
  })
})

