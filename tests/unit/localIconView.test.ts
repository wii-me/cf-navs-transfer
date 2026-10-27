import { describe, expect, it, vi } from 'vitest'
import { createLocalIconView, emptyLocalIcon, type LocalIconState } from '../../src/lib/localIconView'
import type { IconLocalStore } from '../../src/lib/iconLocalStore'

function fakeStore(hits: Record<string, string> = {}) {
  const resolve = vi.fn(async (key: string, version: string) => hits[key + '|' + version] ?? null)
  const store = {
    peek: vi.fn((key: string, version: string) => hits[key + '|' + version] ?? null),
    resolve,
    invalidate: vi.fn(),
  } as unknown as IconLocalStore & { resolve: typeof resolve; invalidate: ReturnType<typeof vi.fn>; peek: ReturnType<typeof vi.fn> }
  return store
}

function view(store: ReturnType<typeof fakeStore>) {
  const states: LocalIconState[] = []
  const instance = createLocalIconView(value => states.push(value), () => store)
  return { instance, states, last: () => states.at(-1) ?? emptyLocalIcon }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('local icon view', () => {
  it('publishes a local hit synchronously and never fetches', () => {
    const store = fakeStore({ 'bookmark:5|/api/icon/5?v=1': 'blob:hit' })
    const { instance, last } = view(store)
    instance.set({ id: 5, online_url: '/api/icon/5?v=1&key=k', visible: true })
    expect(last()).toEqual({ active: true, url: 'blob:hit', pending: false })
    expect(store.resolve).not.toHaveBeenCalled()
  })

  it('hides the hit while off screen and shows it once visible', () => {
    const store = fakeStore({ 'category:2|/api/category-icon/2?v=1': 'blob:c' })
    const { instance, last } = view(store)
    instance.set({ id: 2, object_type: 'category', online_url: '/api/category-icon/2?v=1', visible: false })
    expect(last()).toEqual({ active: true, url: '', pending: false })
    instance.set({ id: 2, object_type: 'category', online_url: '/api/category-icon/2?v=1', visible: true })
    expect(last().url).toBe('blob:c')
  })

  it('downloads a miss through the store and marks private objects by their access key', async () => {
    const store = fakeStore()
    store.resolve.mockResolvedValueOnce('blob:new')
    const { instance, last } = view(store)
    instance.set({ id: 7, online_url: '/api/icon/7?v=2&key=k', visible: true })
    expect(last()).toEqual({ active: true, url: '', pending: true })
    await flush()
    expect(store.resolve).toHaveBeenCalledWith('bookmark:7', '/api/icon/7?v=2', '/api/icon/7?v=2&key=k', true)
    expect(last()).toEqual({ active: true, url: 'blob:new', pending: false })
  })

  it('hands back to the native path when no real image could be stored', async () => {
    const store = fakeStore()
    const { instance, last } = view(store)
    instance.set({ id: 7, online_url: '/api/icon/7?v=2', visible: true })
    await flush()
    expect(last()).toEqual(emptyLocalIcon)
  })

  it('stays inactive for previews, text icons, data URIs and foreign URLs', () => {
    const store = fakeStore()
    const { instance, last } = view(store)
    for (const input of [
      { id: 1, online_url: '/api/icon/1?v=1', visible: true, preview: true },
      { id: 1, online_url: '/api/icon/1?v=1', visible: true, icon_display: 'text' as const },
      { id: 1, online_url: 'data:image/png;base64,AA', visible: true },
      { id: 1, online_url: '/api/icon/2?v=1', visible: true },
      { id: 1, online_url: 'https://example.com/a.png', visible: true },
    ]) {
      instance.set(input)
      expect(last()).toEqual(emptyLocalIcon)
    }
    expect(store.resolve).not.toHaveBeenCalled()
  })

  it('a render failure invalidates the shown entry and hands back', () => {
    const store = fakeStore({ 'bookmark:5|/api/icon/5?v=1': 'blob:hit' })
    const { instance, last } = view(store)
    instance.set({ id: 5, online_url: '/api/icon/5?v=1', visible: true })
    instance.failed()
    expect(store.invalidate).toHaveBeenCalledWith('bookmark:5', '/api/icon/5?v=1')
    expect(last()).toEqual(emptyLocalIcon)
  })

  it('a version change re-resolves', async () => {
    const store = fakeStore({ 'bookmark:5|/api/icon/5?v=1': 'blob:old' })
    const { instance } = view(store)
    instance.set({ id: 5, online_url: '/api/icon/5?v=1', visible: true })
    instance.set({ id: 5, online_url: '/api/icon/5?v=2', visible: true })
    await flush()
    expect(store.resolve).toHaveBeenCalledWith('bookmark:5', '/api/icon/5?v=2', '/api/icon/5?v=2', false)
  })
})
