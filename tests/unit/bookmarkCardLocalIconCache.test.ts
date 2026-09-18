// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import BookmarkCard from '../../src/components/BookmarkCard.svelte'
import type { PublicBookmark } from '../../shared/types'

type CacheEntries = Map<string, Response>

function setupCacheStorage(): CacheEntries {
  const entries: CacheEntries = new Map()
  const cache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    keys: async () => Array.from(entries.keys()).map((url) => new Request(url)),
    put: async (request: Request, response: Response) => {
      entries.set(request.url, response.clone())
    },
    delete: async (request: Request) => entries.delete(request.url),
  }
  const caches = { open: vi.fn(async () => cache) }
  vi.stubGlobal('caches', caches)
  Object.defineProperty(window, 'caches', { value: caches, configurable: true })
  const testUrl = class extends URL {}
  Object.assign(testUrl, {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  })
  vi.stubGlobal('URL', testUrl)
  vi.stubGlobal('IntersectionObserver', undefined)
  window.localStorage.clear()
  return entries
}

function bookmark(): PublicBookmark {
  return {
    id: 42,
    category_id: 1,
    title: 'Cached icon',
    url: 'https://example.com/',
    icon: 'https://example.com/icon.png',
    icon_source: 'custom',
    icon_background_color: null,
    icon_blob: null,
    icon_cached: true,
    description: null,
    open_method: 1,
    sort: 0,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('homepage bookmark local icon cache', () => {
  it('fills persistent Cache Storage on a miss and reuses it after remount', async () => {
    const entries = setupCacheStorage()
    let resolveFetch!: (response: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => fetchPromise)
    vi.stubGlobal('fetch', fetchMock)

    render(BookmarkCard, { props: { bookmark: bookmark() } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('img', { name: 'Cached icon' })).toBeNull()
    resolveFetch(new Response('<svg/>', {
      headers: { 'content-type': 'image/svg+xml', 'content-length': '6' },
    }))
    const firstImage = await screen.findByRole('img', { name: 'Cached icon' })

    expect(firstImage.getAttribute('src')).toBe('blob:test')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/^\/api\/icon\/42\?v=/)
    expect(entries.size).toBe(1)

    cleanup()
    render(BookmarkCard, { props: { bookmark: bookmark() } })
    const secondImage = await screen.findByRole('img', { name: 'Cached icon' })

    expect(secondImage.getAttribute('src')).toBe('blob:test')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(entries.size).toBe(1)
  })
})
