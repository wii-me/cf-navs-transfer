// The toolbar is fixed; its full viewport occlusion (including its bottom gap)
// must remain scrollable space, not just the bar's content-box height.
export function getSortToolbarInset(viewportHeight: number, top: number, height: number): number {
  if (![viewportHeight, top, height].every(Number.isFinite) || height <= 0 || viewportHeight <= 0) return 0
  return Math.max(0, Math.ceil(viewportHeight - Math.max(0, top) + 8))
}

export function observeSortToolbar(node: HTMLElement, onInset: (inset: number) => void) {
  let disposed = false
  let lastInset = -1
  function measure(): void {
    if (disposed) return
    const rect = node.getBoundingClientRect()
    const inset = getSortToolbarInset(window.innerHeight, rect.top, rect.height)
    if (inset !== lastInset) { lastInset = inset; onInset(inset) }
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(node)
  window.addEventListener('resize', measure)
  measure()
  return {
    destroy(): void {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      onInset(0)
    },
  }
}
