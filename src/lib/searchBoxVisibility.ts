export type SearchBoxVisibilityCallback = (visible: boolean) => void

// 观察首页搜索框（.hero-search）是否在视口内，用于离屏时淡入浮动搜索按钮（REQ-01 / FR-1.1）。
// 用 IntersectionObserver（对齐 iconVisibility.ts 的写法），threshold: 0、无 rootMargin——
// 搜索框离开视口即判为离屏。不新增 window scroll 监听（C-9）。
// 无 IntersectionObserver 时回调恒 true（视作可见 → 不显示离屏浮动按钮），功能降级不报错。
export function observeSearchBoxVisibility(
  element: Element,
  callback: SearchBoxVisibilityCallback,
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true)
    return () => undefined
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) callback(entry.isIntersecting)
    },
    { root: null, threshold: 0 },
  )
  observer.observe(element)

  return () => observer.disconnect()
}
