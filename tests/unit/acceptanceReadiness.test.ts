// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

function readFunction(name: string, next: string) {
  const source = readFileSync('scripts/prod-acceptance.mjs', 'utf8')
  const start = source.indexOf('function ' + name + '(')
  const end = source.indexOf('function ' + next + '(', start)
  if (start < 0 || end < 0) throw new Error('probe function boundary missing')
  return new Function(source.slice(start, end) + '; return ' + name)()
}

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('acceptance modal readiness', () => {
  it('waits for lazy modal modules rather than measuring before they render', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button data-testid="home-create-root-category"></button><section data-home-category-scope><button class="scope-more-trigger"></button></section>'
    let categoryClosed = false
    document.querySelector('[data-testid="home-create-root-category"]')!.addEventListener('click', () => {
      setTimeout(() => {
        const dialog = document.createElement('div')
        dialog.className = 'modal-card'
        dialog.setAttribute('aria-labelledby', 'category-modal-title')
        dialog.innerHTML = '<button>取消</button>'
        dialog.querySelector('button')!.onclick = () => { categoryClosed = true; dialog.remove() }
        document.body.append(dialog)
      }, 900)
    })
    document.querySelector('.scope-more-trigger')!.addEventListener('click', () => {
      setTimeout(() => {
        const button = document.createElement('button')
        button.className = 'scope-more-item'
        button.textContent = '新增书签'
        button.onclick = () => { setTimeout(() => { const modal = document.createElement('div'); modal.className = 'modal-card'; modal.dataset.testid = 'bookmark-modal'; document.body.append(modal) }, 1200) }
        document.body.append(button)
      }, 700)
    })
    const pending = readFunction('pageModalMetrics', 'pageCloseModals')()
    await vi.runAllTimersAsync()
    const result = await pending
    expect(categoryClosed).toBe(true)
    expect(result.results.categoryModal).not.toBeNull()
    expect(result.results.bookmarkModal).not.toBeNull()
  })

  it('still reports a missing bookmark modal instead of accepting another dialog', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<section data-home-category-scope><button class="scope-more-trigger"></button></section><div class="modal-card" aria-labelledby="unrelated-dialog"></div>'
    const pending = readFunction('pageModalMetrics', 'pageCloseModals')()
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.results.bookmarkModal).toBeNull()
  })
})

describe('acceptance precache readiness', () => {
  function probe() {
    const source = readFileSync('scripts/prod-acceptance.mjs', 'utf8')
    const start = source.indexOf('async function waitForPrecache(')
    const end = source.indexOf('// ── 场景', start)
    return new Function('pageCacheReport', 'sleep', source.slice(start, end) + '; return waitForPrecache')(
      () => {}, (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    )
  }

  it('waits for both entry assets to arrive in the same runtime cache', async () => {
    vi.useFakeTimers()
    const empty = { entries: [{ key: 'cf-navs-v123', urls: [] }], totalBytes: 0 }
    const ready = { entries: [{ key: 'cf-navs-v123', urls: ['/assets/index-ready.js', '/assets/index-ready.css'] }], totalBytes: 100 }
    const call = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValue(ready)
    const pending = probe()({ call })
    await vi.runAllTimersAsync()
    expect(await pending).toBe(ready)
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('returns missing evidence at timeout so the acceptance assertion still fails', async () => {
    vi.useFakeTimers()
    const empty = { entries: [], totalBytes: 0 }
    const pending = probe()({ call: vi.fn(async () => empty) }, 300)
    await vi.runAllTimersAsync()
    expect(await pending).toBe(empty)
  })
})
