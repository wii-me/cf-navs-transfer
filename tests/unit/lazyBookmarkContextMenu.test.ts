// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import BookmarkCard from '../../src/components/BookmarkCard.svelte'
import { getLoadedBookmarkContextMenu, loadBookmarkContextMenu } from '../../src/lib/lazyBookmarkContextMenu'
import type { PublicBookmark } from '../../shared/types'

// 代码审查二轮第 4 项：右键菜单（连带 CategoryTreeSelect）不再进首屏 chunk，打开时按需加载。
const bookmark: PublicBookmark = {
  id: 5, category_id: 1, title: 'Lazy', url: 'https://example.test', icon: 'L', icon_source: null,
  icon_cached: false, icon_blob: null, icon_background_color: null, description: null, open_method: 1, sort: 0,
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('lazy bookmark context menu', () => {
  it('opens the editable card menu once the chunk is available', async () => {
    expect(getLoadedBookmarkContextMenu()).toBeNull() // 首屏不带菜单组件
    const onEdit = vi.fn()
    const { container } = render(BookmarkCard, { props: { bookmark, canEdit: true, onEdit } })
    await fireEvent.contextMenu(container.querySelector('a.bookmark-card')!)
    await vi.waitFor(() => expect(container.querySelector('[data-testid="bookmark-context-edit"]')).not.toBeNull())
    await fireEvent.click(container.querySelector('[data-testid="bookmark-context-edit"]')!)
    expect(onEdit).toHaveBeenCalledWith(bookmark)
  })

  it('shares one loaded component across callers', async () => {
    const [a, b] = await Promise.all([loadBookmarkContextMenu(), loadBookmarkContextMenu()])
    expect(a).toBe(b)
    expect(getLoadedBookmarkContextMenu()).toBe(a)
  })

  it('never renders a menu for read-only cards', async () => {
    const { container } = render(BookmarkCard, { props: { bookmark } })
    await fireEvent.contextMenu(container.querySelector('a.bookmark-card')!)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
