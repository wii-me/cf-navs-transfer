// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import Home from '../../src/views/Home.svelte'
import type { PublicBookmark, PublicCategory } from '../../shared/types'

// Home 的 `activeId` 自解析写回（legacy `$: activeId = resolveHomeActiveSectionId(navigationSections, activeId)`，
// 8j 起为「只在解析结果不同时写回」的 `$effect.pre`）：当前高亮的导航项不再存在于导航分区里时，
// 回落到第一个分区；仍存在时保持不变。经 Sidebar 的 `aria-current="location"` 观察。
// 滚动侦测（scroll 监听）同样会写 activeId；这里不派发 scroll，挂载时的那一次侦测由
// `requestAnimationFrame` 桩吞掉，确保观察到的只是写回语句本身。

beforeEach(() => {
  localStorage.setItem('cf-navs:guide-seen', '1')
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function flush(): Promise<void> {
  await tick()
  await tick()
}

function bookmark(id: number, categoryId: number, title: string): PublicBookmark {
  return {
    id, category_id: categoryId, title, url: `https://${title.toLowerCase()}.example`, icon: title[0], icon_source: null,
    icon_background_color: null, icon_blob: null, icon_cached: false, description: null, description_mode: null, open_method: 1, sort: id, click_count: 0,
  } as PublicBookmark
}

const categories: PublicCategory[] = [
  { id: 1, parent_id: null, title: '开发', icon: null, sort: 0 },
  { id: 2, parent_id: null, title: '设计', icon: null, sort: 1 },
  { id: 3, parent_id: 2, title: '配色', icon: null, sort: 0 },
]
// 常驻展开的左侧导航：子分类项可见，才能观察子分类的高亮。
const settings = { navigation: { position: 'left', always_expanded: true, top_layout: 'scroll' } } as never
const bookmarks = [bookmark(11, 1, 'GitHub'), bookmark(21, 2, 'Figma'), bookmark(31, 3, 'Coolors')]

const current = (container: HTMLElement) =>
  [...container.querySelectorAll('[aria-current="location"]')].map((node) => node.getAttribute('title'))
const childTab = () => document.getElementById('home-category-tab-3') as HTMLButtonElement

describe('Home activeId 解析写回', () => {
  it('首次挂载即高亮第一个分区', async () => {
    const { container } = render(Home, { props: { categories, bookmarks } })
    await flush()
    expect(current(container)).toEqual(['开发'])
  })

  it('分类异步到达（先空后有）时回落到第一个分区', async () => {
    const { container, rerender } = render(Home, { props: { categories: [], bookmarks: [] } })
    await flush()
    expect(current(container)).toEqual([])
    await rerender({ categories, bookmarks })
    await flush()
    expect(current(container)).toEqual(['开发'])
  })

  it('当前高亮仍存在时保持；被删除后回落到第一个分区', async () => {
    const { container, rerender } = render(Home, { props: { categories, bookmarks, settings } })
    await flush()
    await fireEvent.click(container.querySelector('[aria-label="展开 设计 的子分类"]') as HTMLButtonElement)
    await fireEvent.click(childTab())
    await flush()
    expect(current(container)).toEqual(['配色'])

    // 无关变化（新增分类、书签变化）不改变仍然有效的高亮
    const withExtra = [...categories, { id: 4, parent_id: null, title: '阅读', icon: null, sort: 2 }]
    await rerender({ categories: withExtra, bookmarks: [...bookmarks, bookmark(41, 4, 'Feedly')] })
    await flush()
    expect(current(container)).toEqual(['配色'])

    // 高亮的子分类被删除 → 回落到（新的）第一个分区
    await rerender({ categories: withExtra.filter((category) => category.id !== 3), bookmarks: bookmarks.filter((item) => item.category_id !== 3) })
    await flush()
    expect(current(container)).toEqual(['开发'])
  })

  it('第一个分区本身被删除时回落到新的第一个分区', async () => {
    const { container, rerender } = render(Home, { props: { categories, bookmarks } })
    await flush()
    expect(current(container)).toEqual(['开发'])
    await rerender({ categories: categories.filter((category) => category.id !== 1), bookmarks: bookmarks.filter((item) => item.category_id !== 1) })
    await flush()
    expect(current(container)).toEqual(['设计'])
  })
})
