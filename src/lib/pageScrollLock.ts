// 页面滚动锁：模态打开时锁住 <html>/<body> 的 overflow，关闭时还原原始值。
//
// 从 BookmarkEditModal 的内联实现原样搬迁（行为逐字节等价）；SearchSpotlight（REQ-01）复用。
// 单槽实现——同一时刻只允许一个使用者持锁：重复 lock 不覆盖已存值，unlock 还原原始值后清空。
// 需要并存多个持锁者时应改引用计数；当前靠调用方互斥回避
// （见 docs/plans/SPOTLIGHT_SEARCH_DEVELOPMENT.md §2.1 / 决策 D-e）。

let previousBodyOverflow: string | null = null
let previousDocumentOverflow: string | null = null

export function setPageScrollLocked(locked: boolean): void {
  if (typeof document === 'undefined') return

  if (locked && previousBodyOverflow === null) {
    previousBodyOverflow = document.body.style.overflow
    previousDocumentOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return
  }

  if (!locked && previousBodyOverflow !== null) {
    document.documentElement.style.overflow = previousDocumentOverflow ?? ''
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = null
    previousDocumentOverflow = null
  }
}
