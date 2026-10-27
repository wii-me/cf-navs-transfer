// App 级全局快捷键的纯决策逻辑（代码审查三轮第 7 项，从 App.svelte 抽出）。
// 只根据按键事件与当前状态给出要执行的动作，不碰 DOM、不调用 preventDefault，
// 由 App 负责执行：动作非 null 时 preventDefault，并打开 / 关闭 Spotlight。

export type GlobalShortcutAction = 'open-spotlight' | 'close-spotlight'

export type GlobalShortcutContext = {
  /** 当前是否停留在首页且首页可见（currentView === 'home' && canSeeHome）。 */
  homeActive: boolean
  spotlightOpen: boolean
}

type ShortcutTarget = {
  tagName?: string
  isContentEditable?: boolean
}

export type GlobalShortcutEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  isComposing: boolean
  target: EventTarget | ShortcutTarget | null
}

/** 输入框、文本域与 contenteditable 中的按键不触发全局快捷键。 */
export function isTypingTarget(target: GlobalShortcutEvent['target']): boolean {
  const element = target as ShortcutTarget | null
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable))
}

/**
 * Ctrl+K / Cmd+K 切换 Spotlight，「/」 打开，Esc 关闭。
 * 排除输入态与 IME 组合输入；仅首页可见时生效。模态互斥仍由调用方的 openSpotlight 把关。
 */
export function resolveGlobalShortcut(
  event: GlobalShortcutEvent,
  context: GlobalShortcutContext,
): GlobalShortcutAction | null {
  if (event.isComposing || event.key === 'Process' || isTypingTarget(event.target)) return null
  if (!context.homeActive) return null

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    return context.spotlightOpen ? 'close-spotlight' : 'open-spotlight'
  }
  if (event.key === '/' && !context.spotlightOpen) return 'open-spotlight'
  if (event.key === 'Escape' && context.spotlightOpen) return 'close-spotlight'
  return null
}
