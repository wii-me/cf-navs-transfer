// 窗口重新获得焦点 / 页面恢复可见时刷新公开数据。
//
// 背景（Issue #25）：后台保存默认搜索引擎等设置后，其他已打开标签页里的首页
// 此前要手动刷新才能看到新设置——应用没有跨标签页同步机制。这里把「focus 事件
// 且页面可见」和「visibilitychange 到 visible」都归一到一次防抖刷新；刷新函数
// 由调用方传入（refreshPublicData），其内部按数据版本门控，数据未变化时不发全量请求。
export function installPublicDataFocusRefresh(
  refresh: () => Promise<unknown>,
  debounceMs = 300,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const refreshAfterDebounce = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!stopped) void refresh()
    }, debounceMs)
  }

  // focus 事件在页面隐藏时也可能派发（例如快速切换窗口），此时不刷新；
  // visibilitychange 恢复可见与 focus 是同一场景，合并成一个处理器并靠防抖去重。
  const handleRefreshSignal = (): void => {
    if (document.visibilityState === 'visible') refreshAfterDebounce()
  }

  window.addEventListener('focus', handleRefreshSignal)
  document.addEventListener('visibilitychange', handleRefreshSignal)

  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('focus', handleRefreshSignal)
    document.removeEventListener('visibilitychange', handleRefreshSignal)
  }
}