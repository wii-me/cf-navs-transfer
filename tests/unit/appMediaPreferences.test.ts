// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readReducedMotion, subscribeSystemDark } from '../../src/lib/appMediaPreferences'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type FakeMediaQueryList = MediaQueryList & {
  emit(matches: boolean): void
  listenerCount(): number
}

function createFakeMediaQueryList(query: string, initial: boolean): FakeMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mql = {
    media: query,
    matches: initial,
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.delete(listener)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    emit(matches: boolean) {
      mql.matches = matches
      for (const listener of [...listeners]) listener({ matches, media: query } as MediaQueryListEvent)
    },
    listenerCount: () => listeners.size,
  }
  return mql as unknown as FakeMediaQueryList
}

/** jsdom 没有 matchMedia：按查询字符串返回各自的假 MediaQueryList。 */
function installMatchMedia(initial: Record<string, boolean>): Map<string, FakeMediaQueryList> {
  const lists = new Map<string, FakeMediaQueryList>()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => {
      let mql = lists.get(query)
      if (!mql) {
        mql = createFakeMediaQueryList(query, initial[query] ?? false)
        lists.set(query, mql)
      }
      return mql
    }),
  })
  return lists
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('app media preferences', () => {
  it('reads prefers-reduced-motion from window.matchMedia', () => {
    installMatchMedia({ [REDUCED_MOTION_QUERY]: true })
    expect(readReducedMotion()).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')

    installMatchMedia({ [REDUCED_MOTION_QUERY]: false })
    expect(readReducedMotion()).toBe(false)
  })

  it('reports the initial dark preference synchronously and follows changes', () => {
    const lists = installMatchMedia({ [SYSTEM_DARK_QUERY]: true })
    const seen: boolean[] = []
    const stop = subscribeSystemDark((value) => seen.push(value))

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(seen).toEqual([true])

    const mql = lists.get(SYSTEM_DARK_QUERY)!
    mql.emit(false)
    mql.emit(true)
    expect(seen).toEqual([true, false, true])
    stop()
  })

  it('stop removes the same change listener, is safe to repeat and silences later changes', () => {
    const lists = installMatchMedia({})
    const onChange = vi.fn()
    const stop = subscribeSystemDark(onChange)
    const mql = lists.get(SYSTEM_DARK_QUERY)!

    expect(mql.addEventListener).toHaveBeenCalledTimes(1)
    expect(mql.listenerCount()).toBe(1)
    const added = (mql.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]

    stop()
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1)
    expect((mql.removeEventListener as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(added)
    expect(mql.listenerCount()).toBe(0)
    expect(() => stop()).not.toThrow()

    mql.emit(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('uses addEventListener only, matching the original App behavior (no legacy addListener)', () => {
    const lists = installMatchMedia({})
    subscribeSystemDark(() => {})()
    const mql = lists.get(SYSTEM_DARK_QUERY)!
    expect(mql.addListener).not.toHaveBeenCalled()
    expect(mql.removeListener).not.toHaveBeenCalled()
  })

  it('degrades safely without matchMedia (plain jsdom)', () => {
    expect('matchMedia' in window).toBe(false)
    const onChange = vi.fn()
    const stop = subscribeSystemDark(onChange)
    expect(onChange).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
    expect(readReducedMotion()).toBe(false)
  })
})
