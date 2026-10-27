<svelte:options runes />

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { on } from 'svelte/events'
  import CategoryTreeSelect from './CategoryTreeSelect.svelte'
  import type { CategoryTreeOption } from '../lib/categorySelect'

  type AsyncVoid<T = void> = T | Promise<T>

  interface Props {
    categories?: CategoryTreeOption[]
    currentCategoryId?: string | number | null
    onEdit?: () => AsyncVoid
    onMoveBookmark?: (categoryId: number) => AsyncVoid
    canMove?: boolean
  }

  let {
    categories = [],
    currentCategoryId = null,
    onEdit,
    onMoveBookmark,
    canMove = false,
  }: Props = $props()

  // 菜单默认从卡片下沿向下展开。页面末尾那一排卡片下方没有空间，菜单会越过视口底边，
  // 「编辑」按钮落在视口外且被裁掉（Issue #30）。这里在挂载后测量真实几何，必要时向上
  // 翻转；上下都不够时再夹紧高度并允许菜单内部滚动。
  const VIEWPORT_MARGIN_PX = 8
  const ANCHOR_OVERLAP_PX = 6

  let movePickerOpen = $state(false)
  let moveCategoryId: string | number | null = $state(untrack(() => currentCategoryId))
  let moveSubmitting = $state(false)
  // 元素引用只在测量函数里用，不进模板依赖。
  let menuElement: HTMLDivElement | null = null
  let placement: 'down' | 'up' = $state('down')
  let maxHeight: number | null = $state(null)
  let topOffset: number | null = $state(null)
  let remeasureQueued = false

  function handleEditClick() {
    void onEdit?.()
  }

  function openMovePicker() {
    if (!onMoveBookmark || categories.length === 0) return
    moveCategoryId = currentCategoryId
    movePickerOpen = true
  }

  function closeMovePicker() {
    movePickerOpen = false
    moveCategoryId = currentCategoryId
    void tick().then(() => menuElement?.querySelector<HTMLButtonElement>('[data-testid="bookmark-context-move"]')?.focus())
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // CategoryTreeSelect handles Escape first. Its preventDefault means「先关内层」，
      // so stop here; otherwise let the event reach BookmarkCard's window listener and
      // close the whole context menu when focus is on 编辑/移动 itself.
      if (event.defaultPrevented) event.stopPropagation()
      return
    }
    event.stopPropagation()
  }

  /**
   * 依据父级卡片与视口的真实几何决定展开方向。
   *
   * 用 `scrollHeight` 而不是 `offsetHeight` 取自然高度：夹紧后 offsetHeight 会被 max-height
   * 截短，再测量就会把已收缩的高度当成内容高度，翻转判定随之失真。
   */
  function measurePlacement(): void {
    if (!menuElement) return
    const anchor = menuElement.parentElement
    if (!anchor) return

    // Flex children shrink inside a clamped menu. Measure without the previous
    // cap, otherwise the shrunken height would repeatedly remove/reapply it.
    // Keep temporary DOM writes on a local reference (historically: assigning
    // through the bound variable would invalidate Svelte and retrigger the remeasure).
    const element = menuElement
    const previousMaxHeight = element.style.maxHeight
    const scrollPositions = [element, ...element.querySelectorAll<HTMLElement>('[role="tree"]')].map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }))
    element.style.maxHeight = 'none'
    const naturalHeight = element.scrollHeight
    element.style.maxHeight = previousMaxHeight
    for (const { node, top, left } of scrollPositions) { node.scrollTop = top; node.scrollLeft = left }
    if (naturalHeight <= 0) return

    const anchorRect = anchor.getBoundingClientRect()
    // 展开方向决定菜单贴住卡片上沿还是下沿（CSS 里用 100% - 6px 制造 6px 重叠）。
    const downStart = anchorRect.bottom - ANCHOR_OVERLAP_PX
    const upStart = anchorRect.top + ANCHOR_OVERLAP_PX
    // Home publishes the fixed sorting bar's exclusion area. Other hosts omit
    // the variable and retain the full viewport as before.
    const toolbarInset = Math.max(0, Number.parseFloat(getComputedStyle(anchor).getPropertyValue('--home-sort-bottom-inset')) || 0)
    const topInset = Math.max(0, Number.parseFloat(getComputedStyle(anchor).getPropertyValue('--home-top-inset')) || 0)
    const visualTop = window.visualViewport?.offsetTop ?? 0
    const viewportTop = Math.max(visualTop, topInset)
    const visualBottom = visualTop + (window.visualViewport?.height ?? window.innerHeight)
    const viewportBottom = Math.max(viewportTop, Math.min(visualBottom, window.innerHeight - toolbarInset))
    const spaceBelow = viewportBottom - downStart - VIEWPORT_MARGIN_PX
    const spaceAbove = upStart - viewportTop - VIEWPORT_MARGIN_PX

    let nextPlacement: 'down' | 'up' = 'down'
    let nextMaxHeight: number | null = null

    if (naturalHeight <= spaceBelow) {
      nextPlacement = 'down'
    } else if (naturalHeight <= spaceAbove) {
      nextPlacement = 'up'
    } else {
      // 两侧都放不下：选空间更大的一侧，并把高度夹到该侧可用空间内。
      nextPlacement = spaceAbove > spaceBelow ? 'up' : 'down'
      nextMaxHeight = Math.max(0, Math.floor(nextPlacement === 'up' ? spaceAbove : spaceBelow))
    }

    let nextTopOffset: number | null = null
    if (movePickerOpen && nextMaxHeight !== null) {
      // A tree needs more than the remainder on one side of a card. Permit it
      // to overlap the anchor while staying inside the unobscured viewport.
      // Otherwise the fixed controls can squeeze its scroll area below one row.
      const available = Math.max(0, viewportBottom - viewportTop - VIEWPORT_MARGIN_PX * 2)
      nextMaxHeight = Math.min(naturalHeight, Math.floor(available))
      const preferredTop = nextPlacement === 'up' ? upStart - nextMaxHeight : downStart
      const menuTop = Math.max(viewportTop + VIEWPORT_MARGIN_PX, Math.min(preferredTop, viewportBottom - VIEWPORT_MARGIN_PX - nextMaxHeight))
      nextTopOffset = menuTop - anchorRect.top - anchor.clientTop
    }
    if (nextTopOffset !== topOffset) topOffset = nextTopOffset
    if (nextPlacement !== placement) placement = nextPlacement
    if (nextMaxHeight !== maxHeight) maxHeight = nextMaxHeight
  }

  function handleViewportScroll(event: Event): void {
    // Internal tree scrolling changes neither the anchor nor available space.
    // Remeasuring it would expand the scroller and reset the user's scrollTop.
    if (event.target instanceof Node && menuElement?.contains(event.target)) return
    scheduleMeasure()
  }

  function scheduleMeasure(): void {
    if (remeasureQueued) return
    remeasureQueued = true
    void tick().then(() => {
      remeasureQueued = false
      measurePlacement()
    })
  }

  // 菜单高度会随「移动」选择器展开而变化，所以每次更新后都重新测量，而不是只在挂载时测一次。
  // 原 after-update 钩子（runes 下不可用）→ 显式读取全部模板依赖的 $effect：挂载后与任一依赖变化后
  // 都在 DOM 更新之后排一次测量（测量写回的 placement / maxHeight / topOffset 变化时同样再测一次，
  // 与原先「测量写回 → 组件更新 → 钩子」一致，写回只在值变化时发生，不会循环）。
  $effect(() => {
    void [placement, maxHeight, topOffset, onEdit, movePickerOpen, canMove, onMoveBookmark, categories, categories.length, moveCategoryId]
    untrack(scheduleMeasure)
  })

  // 菜单内的 click / pointerdown / touch 不冒泡到卡片与 window 的「点外部关闭」监听；keydown 见 handleMenuKeydown。
  // 原 `on:click|stopPropagation` 等是直接挂在菜单节点上的监听：内层按钮与分类选择器的委托处理器先在这里
  // 跑完，再停止冒泡。改成事件属性会走根节点委托、在祖先的原生监听之后才 stopPropagation，所以这里用
  // svelte/events 的 on() 直接挂载，保持原先的挂载点与先后顺序。
  function attachMenuListeners(node: HTMLDivElement): () => void {
    const stop = (event: Event) => event.stopPropagation()
    const offs = [
      on(node, 'click', stop),
      on(node, 'keydown', handleMenuKeydown),
      on(node, 'pointerdown', stop),
      on(node, 'touchstart', stop),
      on(node, 'touchmove', stop),
    ]
    return () => {
      for (const off of offs) off()
    }
  }

  onMount(() => {
    measurePlacement()
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', handleViewportScroll, true)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
  })

  onDestroy(() => {
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('scroll', handleViewportScroll, true)
    window.visualViewport?.removeEventListener('resize', scheduleMeasure)
    window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
  })

  // 原 `$:`：依赖 movePickerOpen / moveSubmitting / onMoveBookmark / moveCategoryId / currentCategoryId，
  // 与原语句一样先于 DOM 更新执行；语句体写回的 moveSubmitting / movePickerOpen 在 untrack 中，
  // 写回引起的重跑因 movePickerOpen 已为 false 而为空操作。
  $effect.pre(() => {
    const open = movePickerOpen
    const submitting = moveSubmitting
    const move = onMoveBookmark
    const target = moveCategoryId
    const current = currentCategoryId
    if (!open || submitting || !move || target == null || Number(target) === Number(current)) return
    untrack(() => {
      const targetCategoryId = Number(target)
      moveSubmitting = true
      movePickerOpen = false
      void Promise.resolve(move(targetCategoryId)).finally(() => {
        moveSubmitting = false
      })
    })
  })
</script>

<div
  class="bookmark-context-menu"
  class:placement-up={placement === 'up'}
  class:clamped={maxHeight !== null}
  bind:this={menuElement}
  style={`${maxHeight !== null ? `max-height: ${maxHeight}px;` : ''}${topOffset !== null ? `top: ${topOffset}px; bottom: auto;` : ''}`}
  role="menu"
  tabindex="-1"
  {@attach attachMenuListeners}
>
  {#if onEdit && !movePickerOpen}
    <button type="button" data-testid="bookmark-context-edit" onclick={handleEditClick}>编辑</button>
  {/if}
  {#if canMove && onMoveBookmark && categories.length > 0 && !movePickerOpen}
    <button type="button" data-testid="bookmark-context-move" onclick={openMovePicker}>移动</button>
  {/if}
  {#if movePickerOpen}
    <div class="move-picker" data-testid="bookmark-context-move-picker">
      <CategoryTreeSelect
        bind:value={moveCategoryId}
        items={categories}
        ariaLabel="移动到分类"
        compact
        inlineMenu
        onLayoutChange={scheduleMeasure}
        testId="bookmark-context-move-select"
      />
      <button type="button" class="move-cancel" onclick={closeMovePicker}>取消</button>
    </div>
  {/if}
</div>

<style>
  .bookmark-context-menu {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: calc(100% - 6px);
    left: 8px;
    right: 8px;
    z-index: 80;
    min-width: 0;
    padding: 6px;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.22);
    backdrop-filter: blur(10px);
  }

  /* 底部卡片：从卡片上沿向上展开，避免编辑按钮被视口底边裁掉（Issue #30）。 */
  .bookmark-context-menu.placement-up {
    top: auto;
    bottom: calc(100% - 6px);
  }

  /* 上下空间都不足时按可用高度夹紧，并允许菜单内部滚动而不是把按钮挤出视口。 */
  .bookmark-context-menu.clamped {
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .bookmark-context-menu button {
    flex-shrink: 0;
    width: 100%;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #0f172a;
    cursor: pointer;
    font-size: 13px;
    padding: 7px 12px;
    text-align: left;
  }

  .bookmark-context-menu button:hover,
  .bookmark-context-menu button:focus-visible {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .move-picker {
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    min-height: 0;
    gap: 6px;
    min-width: 0;
    /* The picker replaces the action rows, leaving room in short viewports. */
  }

  .move-cancel {
    text-align: center !important;
  }

  :global([data-theme='dark']) .bookmark-context-menu {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.94);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.32);
  }

  :global([data-theme='dark']) .bookmark-context-menu button {
    color: #e5eefb;
  }

  :global([data-theme='dark']) .bookmark-context-menu button:hover,
  :global([data-theme='dark']) .bookmark-context-menu button:focus-visible {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
  }
</style>
