export type ConfirmDialogVariant = 'default' | 'danger'

export type ConfirmDialogState = {
  title: string
  message: string
  itemTitle: string
  confirmLabel: string
  cancelLabel: string
  variant: ConfirmDialogVariant
  confirmDisabled: boolean
}

export type ConfirmDialogInput = {
  title: string
  message: string
  itemTitle?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmDialogVariant
  confirmDisabled?: boolean
}

export function createConfirmDialogState(input: ConfirmDialogInput): ConfirmDialogState {
  return {
    title: input.title,
    message: input.message,
    itemTitle: input.itemTitle ?? '',
    confirmLabel: input.confirmLabel ?? '确认',
    cancelLabel: input.cancelLabel ?? '取消',
    variant: input.variant ?? 'default',
    confirmDisabled: input.confirmDisabled ?? false,
  }
}

export type ConfirmController = {
  /** 打开确认框；返回的 promise 在确认时为 true，取消、关闭或被新请求顶替时为 false。 */
  request(input: ConfirmDialogInput): Promise<boolean>
  /** 关闭当前确认框并以 confirmed 兑现其 promise；没有待决请求时只清空状态。 */
  close(confirmed: boolean): void
  /** 当前确认框状态，未打开时为 null。 */
  getState(): ConfirmDialogState | null
}

/**
 * 确认对话框控制器（代码审查三轮第 10 项，从 App.svelte 抽出）。单 resolver 语义，与原实现一致：
 * - request 先以 false 兑现上一个仍待决的请求（被顶替），再登记新的 resolver 并同步推送新状态；
 *   两个状态之间不会推送 null，上一个请求的后续代码（微任务）执行时新确认框已经打开。
 * - close 先摘下 resolver、推送 null，再兑现 promise，因此 await 之后读到的状态已关闭；
 *   重复 close 不会重复兑现。
 * onChange 在每次状态赋值时调用（close 即使原本就是 null 也会调用一次，与原先的无条件赋值一致）。
 */
export function createConfirmController(
  onChange: (state: ConfirmDialogState | null) => void,
): ConfirmController {
  let state: ConfirmDialogState | null = null
  let resolver: ((confirmed: boolean) => void) | null = null

  function setState(next: ConfirmDialogState | null): void {
    state = next
    onChange(next)
  }

  return {
    request(input) {
      resolver?.(false)

      return new Promise<boolean>((resolve) => {
        resolver = resolve
        setState(createConfirmDialogState(input))
      })
    },
    close(confirmed) {
      const current = resolver
      resolver = null
      setState(null)
      current?.(confirmed)
    },
    getState() {
      return state
    },
  }
}

export function createDeleteCategoryConfirmation(
  categoryTitle: string,
  directBookmarkCount = 0,
  childCategoryCount = 0,
): ConfirmDialogInput {
  const blocked = childCategoryCount > 0
  return {
    title: '删除分类',
    message: blocked
      ? `该分类有 ${directBookmarkCount} 个直属书签和 ${childCategoryCount} 个子分类。请先移动或删除子分类，当前不能删除。`
      : `删除后该分类及其 ${directBookmarkCount} 个直属书签都会从首页和后台列表中移除，此操作不可撤销。`,
    itemTitle: categoryTitle,
    confirmLabel: blocked ? '存在子分类' : '确认删除',
    confirmDisabled: blocked,
    variant: 'danger',
  }
}

export function createDeleteBookmarkConfirmation(bookmarkTitle: string): ConfirmDialogInput {
  return {
    title: '删除书签',
    message: '删除后该书签会从首页和后台列表中移除，此操作不可撤销。',
    itemTitle: bookmarkTitle,
    confirmLabel: '确认删除',
    variant: 'danger',
  }
}

export function createBatchDeleteConfirmation(
  kind: 'category' | 'bookmark',
  count: number,
  bookmarkCount = 0,
  childCategoryCount = 0,
): ConfirmDialogInput {
  const blocked = kind === 'category' && childCategoryCount > 0
  return {
    title: `批量删除${kind === 'category' ? '分类' : '书签'}`,
    message: kind === 'category'
      ? blocked
        ? `已选分类包含 ${bookmarkCount} 个直属书签和 ${childCategoryCount} 个子分类。请先移动或删除这些子分类，当前不能批量删除。`
        : `将删除 ${count} 个分类及其 ${bookmarkCount} 个直属书签，此操作不可撤销。`
      : `将删除 ${count} 个书签，此操作不可撤销。`,
    confirmLabel: blocked ? '存在子分类' : '确认删除',
    confirmDisabled: blocked,
    variant: 'danger',
  }
}

// 备份文件里会随 settings 带进来、且导入后会被浏览器执行或原样渲染的内容。
//
// 这条提示存在的理由：`POST /api/import` 的覆盖模式会写 `settings`，而
// `custom_js` / `footer_html` 都在可写的 key 列表里。从论坛或别人那里拿到的
// 备份 JSON 完全可能夹带这两项，导入后立刻对所有访客生效——而现有的确认弹窗
// 只说了「覆盖 N 个分类、M 个书签」，对此只字不提。
//
// 真正危险的是「静默」而不是「能执行」：管理员想给自己的站点加脚本是合法需求。
// 所以这里不拦截、不丢弃，只是把隐藏的事情说出来，让管理员做知情决定。
export type ExecutableImportContent = { label: string; effect: string; bytes: number }

const EXECUTABLE_SETTINGS: Array<{ key: 'custom_js' | 'footer_html'; label: string; effect: string }> = [
  { key: 'custom_js', label: '自定义 JS', effect: '会在所有访客的浏览器中执行' },
  { key: 'footer_html', label: '页脚 HTML', effect: '会原样插入首页' },
]

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function formatByteSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

export function describeExecutableImportContent(settings: unknown): ExecutableImportContent[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []

  const record = settings as Record<string, unknown>
  const found: ExecutableImportContent[] = []
  for (const { key, label, effect } of EXECUTABLE_SETTINGS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      found.push({ label, effect, bytes: byteLength(value) })
    }
  }

  return found
}

export function createImportOverwriteConfirmation(input: {
  sourceLabel: string
  categories: number
  bookmarks: number
  payload?: { settings?: unknown }
}): ConfirmDialogInput {
  const base = `导入 ${input.sourceLabel} 将覆盖现有的全部分类与书签（${input.categories} 个分类，${input.bookmarks} 个书签），此操作不可撤销。`
  const executable = describeExecutableImportContent(input.payload?.settings)
  const warning = executable.length === 0
    ? ''
    : `\n\n注意：这份备份还包含 ${executable
        .map((item) => `${item.label}（${formatByteSize(item.bytes)}，${item.effect}）`)
        .join('、')}。只在你信任来源时继续。`

  return {
    title: '导入并覆盖数据',
    message: `${base}${warning}`,
    confirmLabel: '确认导入',
    variant: 'danger',
  }
}
