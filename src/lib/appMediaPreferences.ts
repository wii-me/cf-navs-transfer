// 系统外观偏好（深色模式 / 减少动态效果）的媒体查询读取与订阅（代码审查三轮第 8 项，从 App.svelte 抽出）。
// SSR / 测试环境没有 window.matchMedia 时安全降级：读取返回 false，订阅不回调并返回空操作的 stop。
// 与原实现一致：只用 addEventListener('change')，原实现没有旧版 addListener 兼容，这里也不加；
// 减少动态效果只在挂载时读一次，不订阅变化。

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia)
}

/** 系统是否要求减少动态效果；没有 matchMedia 时为 false。 */
export function readReducedMotion(): boolean {
  return hasMatchMedia() && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 订阅系统深色模式：立即以当前值同步回调一次，之后每次变化回调。
 * 返回 stop，移除同一个监听函数（重复调用无副作用）。没有 matchMedia 时不回调。
 */
export function subscribeSystemDark(onChange: (prefersDark: boolean) => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  onChange(mediaQuery.matches)
  const handleChange = (event: MediaQueryListEvent): void => onChange(event.matches)
  mediaQuery.addEventListener('change', handleChange)
  return () => mediaQuery.removeEventListener('change', handleChange)
}
