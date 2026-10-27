// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 代码审查三轮第 21 项（APP_SPLIT_PLAN 第 8d 步）：CachedBookmarkIcon 迁移到 runes 之前的行为基线。
// 只替换模块边界（本地缓存读写、可信图标视图、可见性观察），按 id 的图标显示覆盖表用真实实现。
// 在 legacy 实现上写成并通过，迁移时不改一行。

const h = vi.hoisted(() => {
  type View = { set: ReturnType<typeof vi.fn>; failed: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; publish: (value: { active: boolean; url: string; pending: boolean }) => void }
  return {
    views: [] as View[],
    visible: [] as Array<() => void>,
    stopVisibility: vi.fn(),
    pending: [] as Array<{ key: string; resolve: (value: { url: string | null; stale: boolean }) => void }>,
  }
})

vi.mock('../../src/lib/localIconView', () => ({
  emptyLocalIcon: { active: false, url: '', pending: false },
  createLocalIconView: (onChange: (value: { active: boolean; url: string; pending: boolean }) => void) => {
    const view = { set: vi.fn(), failed: vi.fn(), destroy: vi.fn(), publish: onChange }
    h.views.push(view)
    return view
  },
}))

vi.mock('../../src/lib/iconVisibility', () => ({
  observeIconVisibility: (_element: Element, callback: () => void) => {
    h.visible.push(callback)
    return h.stopVisibility
  },
}))

vi.mock('../../src/lib/localBookmarkIconCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/localBookmarkIconCache')>()
  return {
    ...actual,
    readCachedBookmarkIconDataUri: vi.fn(() => null),
    deleteCachedBookmarkIcon: vi.fn(async () => { }),
    revokeLocalIconUrl: vi.fn(),
    fetchCachedBookmarkIconUrl: vi.fn((key: string) => new Promise((resolve) => { h.pending.push({ key, resolve }) })),
  }
})

const cache = await import('../../src/lib/localBookmarkIconCache')
const { bookmarkIconDisplay } = await import('../../src/lib/iconDisplayStore')
const { default: CachedBookmarkIcon } = await import('../../src/components/CachedBookmarkIcon.svelte')

const img = () => document.querySelector('.cached-icon-frame img') as HTMLImageElement | null
const frame = () => document.querySelector('.cached-icon-frame') as HTMLElement
const view = () => h.views.at(-1)!
const keyOf = (id: number, icon: string, iconSource: string | null = null) => cache.createBookmarkIconCacheKey({ id, icon, iconSource })
async function settle(index: number, url: string | null, stale = false) {
  h.pending[index].resolve({ url, stale })
  await tick()
  await tick()
}

beforeEach(() => {
  h.views.length = 0
  h.visible.length = 0
  h.pending.length = 0
  h.stopVisibility.mockClear()
  vi.mocked(cache.readCachedBookmarkIconDataUri).mockClear()
  vi.mocked(cache.deleteCachedBookmarkIcon).mockClear()
  vi.mocked(cache.revokeLocalIconUrl).mockClear()
  vi.mocked(cache.fetchCachedBookmarkIconUrl).mockClear()
})

afterEach(() => {
  cleanup()
  bookmarkIconDisplay.clear()
})

describe('CachedBookmarkIcon', () => {
  it('shows an external src at once, then swaps to the cached local URL', async () => {
    render(CachedBookmarkIcon, { id: 7, icon: ' https://e.com/i.png ', src: 'https://e.com/i.png', alt: 'E', className: 'c', style: 'width:1px' })
    expect(img()!.getAttribute('src')).toBe('https://e.com/i.png')
    expect(img()!.getAttribute('alt')).toBe('E')
    expect(img()!.className).toContain('c')
    expect(img()!.getAttribute('style')).toMatch(/^width: ?1px;?$/)
    expect(img()!.getAttribute('loading')).toBe('lazy')
    expect(cache.fetchCachedBookmarkIconUrl).toHaveBeenCalledTimes(1)
    expect(h.pending[0].key).toBe(keyOf(7, 'https://e.com/i.png'))
    expect(cache.readCachedBookmarkIconDataUri).toHaveBeenCalledWith(keyOf(7, 'https://e.com/i.png'))

    await settle(0, 'blob:local')
    expect(img()!.getAttribute('src')).toBe('blob:local')
  })

  it('waits for the local cache before showing a proxied /api/icon src', async () => {
    render(CachedBookmarkIcon, { id: 8, icon: 'https://e.com/i.png', src: '/api/icon/8?v=1', fallback: '书' })
    expect(img()).toBeNull()
    expect(frame().textContent?.trim()).toBe('书')
    await settle(0, null)
    expect(img()!.getAttribute('src')).toBe('/api/icon/8?v=1')
  })

  it('ignores a stale cache result', async () => {
    render(CachedBookmarkIcon, { id: 8, icon: 'x', src: '/api/icon/8?v=1' })
    await settle(0, 'blob:late', true)
    expect(img()).toBeNull()
  })

  it('an error on the local URL revokes it and falls back to src; a second error shows the fallback; a new src retries', async () => {
    const rendered = render(CachedBookmarkIcon, { id: 9, icon: 'https://e.com/a.png', src: 'https://e.com/a.png', fallback: 'F' })
    await settle(0, 'blob:a')
    await fireEvent.error(img()!)
    expect(cache.revokeLocalIconUrl).toHaveBeenCalledWith('blob:a')
    expect(img()!.getAttribute('src')).toBe('https://e.com/a.png')
    await fireEvent.error(img()!)
    expect(img()).toBeNull()
    expect(frame().textContent?.trim()).toBe('F')

    await rendered.rerender({ id: 9, icon: 'https://e.com/a.png', src: 'https://e.com/b.png', fallback: 'F' })
    expect(img()!.getAttribute('src')).toBe('https://e.com/b.png')
    expect(cache.fetchCachedBookmarkIconUrl).toHaveBeenCalledTimes(2)

    // 与状态键无关的 prop 变化不重新加载
    await rendered.rerender({ id: 9, icon: 'https://e.com/a.png', src: 'https://e.com/b.png', fallback: 'G', alt: 'x' })
    expect(cache.fetchCachedBookmarkIconUrl).toHaveBeenCalledTimes(2)
  })

  it('changing the icon revokes the previous local URL and reloads with the new key', async () => {
    const rendered = render(CachedBookmarkIcon, { id: 10, icon: 'https://e.com/a.png', src: 'https://e.com/a.png' })
    await settle(0, 'blob:a')
    await rendered.rerender({ id: 10, icon: 'https://e.com/c.png', src: 'https://e.com/a.png' })
    expect(cache.revokeLocalIconUrl).toHaveBeenCalledWith('blob:a')
    expect(h.pending[1].key).toBe(keyOf(10, 'https://e.com/c.png'))
    expect(img()!.getAttribute('src')).toBe('https://e.com/a.png')
  })

  it('a data-image blob is shown directly and drops the local copy instead of fetching it', async () => {
    const blob = 'data:image/png;base64,AAAA'
    render(CachedBookmarkIcon, { id: 11, icon: 'x', iconBlob: ` ${blob} `, src: '/api/icon/11' })
    expect(img()!.getAttribute('src')).toBe(blob)
    expect(cache.deleteCachedBookmarkIcon).toHaveBeenCalledExactlyOnceWith(keyOf(11, 'x'))
    expect(cache.fetchCachedBookmarkIconUrl).not.toHaveBeenCalled()
  })

  it('feeds the local icon view and prefers its URL while active; errors go to the local icon owner', async () => {
    const rendered = render(CachedBookmarkIcon, { id: '12', icon: ' https://e.com/a.png ', iconCached: true, iconRevision: 'r1', iconWriteEpoch: 3, iconDisplay: 'image', src: 'https://e.com/a.png' })
    expect(view().set).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 12, icon: 'https://e.com/a.png', icon_blob: '', icon_revision: 'r1', icon_cached: true, icon_write_epoch: 3, icon_display: 'image', visible: false, online_url: 'https://e.com/a.png',
    }))
    h.visible[0]()
    await tick()
    expect(view().set).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))

    view().publish({ active: true, url: 'blob:trusted', pending: false })
    await tick()
    expect(img()!.getAttribute('src')).toBe('blob:trusted')
    // 可信视图接管后状态键变化，但不再走本地缓存
    expect(cache.fetchCachedBookmarkIconUrl).toHaveBeenCalledTimes(1)
    await fireEvent.error(img()!)
    expect(view().failed).toHaveBeenCalledTimes(1)

    view().publish({ active: true, url: '', pending: true })
    await tick()
    expect(img()).toBeNull()

    view().publish({ active: false, url: '', pending: false })
    await tick()
    expect(img()!.getAttribute('src')).toBe('https://e.com/a.png')
    expect(cache.fetchCachedBookmarkIconUrl).toHaveBeenCalledTimes(2)

    const calls = view().set.mock.calls.length
    await rendered.rerender({ id: '12', icon: ' https://e.com/a.png ', iconCached: true, iconRevision: 'r1', iconWriteEpoch: 3, iconDisplay: 'image', src: 'https://e.com/z.png' })
    expect(view().set.mock.calls.length).toBeGreaterThan(calls)
    expect(view().set).toHaveBeenLastCalledWith(expect.objectContaining({ online_url: 'https://e.com/z.png' }))
  })

  it('applies the per-id icon display override from the shared store', async () => {
    render(CachedBookmarkIcon, { id: 13, icon: 'https://e.com/a.png', iconWriteEpoch: 1, src: 'https://e.com/a.png' })
    bookmarkIconDisplay.set(13, { dataset_epoch: 'd', icon_revision: null, icon_write_epoch: 2, icon_display: 'empty' })
    await tick()
    expect(view().set).toHaveBeenLastCalledWith(expect.objectContaining({ icon: '', icon_blob: '', icon_display: 'empty', icon_write_epoch: 2, icon_cached: false }))
    expect(h.pending.at(-1)!.key).toBe(keyOf(13, ''))

    bookmarkIconDisplay.clear()
    await tick()
    expect(view().set).toHaveBeenLastCalledWith(expect.objectContaining({ icon: 'https://e.com/a.png', icon_write_epoch: 1 }))
  })

  it('cleans up on destroy', async () => {
    const rendered = render(CachedBookmarkIcon, { id: 14, icon: 'https://e.com/a.png', src: 'https://e.com/a.png' })
    await settle(0, 'blob:a')
    rendered.unmount()
    expect(view().destroy).toHaveBeenCalledTimes(1)
    expect(h.stopVisibility).toHaveBeenCalledTimes(1)
    expect(cache.revokeLocalIconUrl).toHaveBeenCalledWith('blob:a')
  })
})
