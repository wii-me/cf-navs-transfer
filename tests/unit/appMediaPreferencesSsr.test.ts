import { describe, expect, it, vi } from 'vitest'
import { readReducedMotion, subscribeSystemDark } from '../../src/lib/appMediaPreferences'

// node 环境下没有 window（SSR / 预渲染）：读取与订阅都安全降级。
describe('app media preferences without window', () => {
  it('reads false and subscribes to nothing', () => {
    expect(typeof window).toBe('undefined')
    const onChange = vi.fn()
    const stop = subscribeSystemDark(onChange)
    expect(onChange).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
    expect(readReducedMotion()).toBe(false)
  })
})
