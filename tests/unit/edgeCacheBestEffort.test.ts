import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachePublicDataResponse, invalidatePublicDataCache } from '../../worker/lib/cache'

// 边缘缓存写入 / 失效是尽力而为：失败不能让请求失败，但必须在 Workers 日志里留下结构化记录。
const failure = new Error('cache unavailable')
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: { put: vi.fn(async () => { throw failure }), delete: vi.fn(async () => { throw failure }) } },
  })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
})

describe('edge cache best-effort operations', () => {
  it('logs a failed cache write when there is no ExecutionContext', async () => {
    const c = { get executionCtx(): never { throw new Error('This context has no ExecutionContext') } }
    expect(() => cachePublicDataResponse(c, 'https://navs.example.test/api/public/data', new Response('{}'))).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[edge-cache] best-effort cache operation failed:', failure))
  })

  it('hands waitUntil an already-observed promise and logs the failure', async () => {
    const waited: Promise<unknown>[] = []
    const c = { executionCtx: { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } }
    invalidatePublicDataCache(c, 'https://navs.example.test/api/public/data')
    expect(waited).toHaveLength(1)
    await expect(waited[0]).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[edge-cache] best-effort cache operation failed:', failure)
  })
})
