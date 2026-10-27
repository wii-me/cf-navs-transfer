// 书签右键 / 长按菜单按需加载：它连带 CategoryTreeSelect（约 27KB），只有能编辑或移动书签的
// 登录态才会用到，不进首屏 chunk（代码审查二轮第 4 项）。全部卡片共用一个加载 promise。

import type BookmarkContextMenu from '../components/BookmarkContextMenu.svelte'

export type BookmarkContextMenuComponent = typeof BookmarkContextMenu

let loaded: BookmarkContextMenuComponent | null = null
let pending: Promise<BookmarkContextMenuComponent> | null = null
let preloadScheduled = false

export function getLoadedBookmarkContextMenu(): BookmarkContextMenuComponent | null {
  return loaded
}

export function loadBookmarkContextMenu(): Promise<BookmarkContextMenuComponent> {
  if (loaded) return Promise.resolve(loaded)
  pending ??= import('../components/BookmarkContextMenu.svelte').then(
    (module) => { loaded = module.default; return loaded },
    (error) => { pending = null; throw error },
  )
  return pending
}

/** 有卡片可能打开菜单时，在空闲时预取，让首次右键 / 长按不必等网络。只调度一次。 */
export function preloadBookmarkContextMenuWhenIdle(): void {
  if (loaded || pending || preloadScheduled || typeof window === 'undefined') return
  preloadScheduled = true
  const run = () => {
    // 预取失败不影响首屏：真正打开菜单时会重新加载并在失败时提示。
    loadBookmarkContextMenu().catch((error) => console.warn('[CF-Navs] context menu preload failed', error))
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
