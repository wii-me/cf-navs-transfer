// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { clearIconAccessKey, ensureIconAccessKey, iconAccessKey } from '../../src/lib/iconAccessKey'

// 授权 key 的寿命只有 30 分钟，且不查撤销名单——登出/改密码只能靠 clearIconAccessKey()。
// clear 无法取消已经发出的请求，所以必须让它的回调作废，否则过期 key 会在登出后
// 被重新发布并挂回图标 URL（Issue #28 复核发现的竞态）。
const grant = (key: string, ttlMs = 30 * 60 * 1000) => async () => ({
  key,
  expires_at: Date.now() + ttlMs,
})

beforeEach(() => {
  clearIconAccessKey()
  vi.restoreAllMocks()
})

describe('icon access key lifecycle', () => {
  it('publishes a fetched key', async () => {
    await ensureIconAccessKey(grant('KEY-A'))

    expect(get(iconAccessKey)).toBe('KEY-A')
  })

  it('does not publish a key that resolves after the session was cleared', async () => {
    const pending = Promise.withResolvers<{ key: string; expires_at: number }>()
    const fetching = ensureIconAccessKey(() => pending.promise)

    // 登出 / 改密码发生在请求在途期间
    clearIconAccessKey()
    pending.resolve({ key: 'STALE-KEY', expires_at: Date.now() + 30 * 60 * 1000 })

    expect(await fetching).toBe('')
    expect(get(iconAccessKey)).toBe('')
  })

  it('lets a fresh request after a clear still publish its own key', async () => {
    const firstRequest = Promise.withResolvers<{ key: string; expires_at: number }>()
    const first = ensureIconAccessKey(() => firstRequest.promise)

    clearIconAccessKey()
    const second = ensureIconAccessKey(grant('KEY-B'))
    firstRequest.resolve({ key: 'STALE-KEY', expires_at: Date.now() + 30 * 60 * 1000 })

    expect(await first).toBe('')
    expect(await second).toBe('KEY-B')
    expect(get(iconAccessKey)).toBe('KEY-B')
  })

  it('treats an expired key as unusable without refetching', async () => {
    const fetchGrant = vi.fn(grant('KEY-C', 1000))

    // 已过期：readIconAccessKey 会把它算作空，因此会重新取一次。
    expect(await ensureIconAccessKey(fetchGrant, Date.now() + 60 * 1000)).toBe('')
    expect(fetchGrant).toHaveBeenCalledOnce()
  })
})
