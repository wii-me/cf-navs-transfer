// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import BookmarkCard from '../../src/components/BookmarkCard.svelte'
import type { PublicBookmark } from '../../shared/types'

// jsdom 没有 IndexedDB：本地库退回内存层，仍可验证「同版本不再请求、版本变了只重下这一张」。
function bookmark(revision = 'sha256-' + 'a'.repeat(64)): PublicBookmark {
  return {
    id: 77, category_id: 1, title: 'Local first', url: 'https://example.com/', icon: 'https://example.com/icon.png',
    icon_source: 'custom', icon_background_color: null, icon_blob: null, icon_cached: true, icon_revision: revision,
    description: null, open_method: 1, sort: 0,
  } as PublicBookmark
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('bookmark card local-first icon', () => {
  it('reuses the stored image across remounts and refetches only after the version changes', async () => {
    let seq = 0
    const testUrl = class extends URL { }
    Object.assign(testUrl, { createObjectURL: vi.fn(() => 'blob:local-' + ++seq), revokeObjectURL: vi.fn() })
    vi.stubGlobal('URL', testUrl)
    vi.stubGlobal('IntersectionObserver', undefined)
    const fetchMock = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(BookmarkCard, { props: { bookmark: bookmark() } })
    const first = await screen.findByRole('img', { name: 'Local first' })
    expect(first.getAttribute('src')).toMatch(/^blob:local-/)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    cleanup()
    render(BookmarkCard, { props: { bookmark: bookmark() } })
    const second = await screen.findByRole('img', { name: 'Local first' })
    expect(second.getAttribute('src')).toBe(first.getAttribute('src'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    cleanup()
    render(BookmarkCard, { props: { bookmark: bookmark('sha256-' + 'b'.repeat(64)) } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const third = await screen.findByRole('img', { name: 'Local first' })
    await waitFor(() => expect(third.getAttribute('src')).not.toBe(first.getAttribute('src')))
  })
})
