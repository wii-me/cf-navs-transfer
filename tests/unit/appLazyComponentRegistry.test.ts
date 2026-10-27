import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { createLazyComponentRegistry } from '../../src/lib/appLazyComponent'

type Module<T> = { default: T }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('lazy component registry', () => {
  it('exposes one null store per loader and does not load eagerly', () => {
    const admin = vi.fn(async () => ({ default: { name: 'Admin' } }))
    const login = vi.fn(async () => ({ default: { name: 'LoginModal' } }))
    const registry = createLazyComponentRegistry({ Admin: admin, LoginModal: login })

    expect(Object.keys(registry.components)).toEqual(['Admin', 'LoginModal'])
    expect(get(registry.components.Admin)).toBeNull()
    expect(get(registry.components.LoginModal)).toBeNull()
    expect(admin).not.toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
  })

  it('shares one pending load for concurrent ensure calls and publishes the component once', async () => {
    const component = { name: 'Admin' }
    const load = deferred<Module<typeof component>>()
    const loader = vi.fn(() => load.promise)
    const registry = createLazyComponentRegistry({ Admin: loader })
    const seen: unknown[] = []
    const stop = registry.components.Admin.subscribe((value) => seen.push(value))

    const first = registry.ensure('Admin')
    const second = registry.ensure('Admin')
    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledTimes(1)

    load.resolve({ default: component })
    await Promise.all([first, second])

    expect(seen).toEqual([null, component])
    stop()
  })

  it('publishes the component before the ensure promise settles', async () => {
    const component = { name: 'SearchSpotlight' }
    const registry = createLazyComponentRegistry({ SearchSpotlight: async () => ({ default: component }) })

    await registry.ensure('SearchSpotlight')

    // 调用方 await 之后立即读取到的已经是组件（App 依赖这一点在加载后立刻切视图 / 开模态）。
    expect(get(registry.components.SearchSpotlight)).toBe(component)
  })

  it('does not reload or re-publish once a component is loaded', async () => {
    const component = { name: 'LoginModal' }
    const loader = vi.fn(async () => ({ default: component }))
    const registry = createLazyComponentRegistry({ LoginModal: loader })
    const seen: unknown[] = []
    const stop = registry.components.LoginModal.subscribe((value) => seen.push(value))

    await registry.ensure('LoginModal')
    await registry.ensure('LoginModal')
    await registry.ensure('LoginModal')

    expect(loader).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([null, component])
    stop()
  })

  it('propagates the load error, keeps the store null and retries on the next ensure', async () => {
    const component = { name: 'Recover' }
    const error = new Error('chunk failed')
    const loader = vi
      .fn<() => Promise<Module<typeof component>>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ default: component })
    const registry = createLazyComponentRegistry({ Recover: loader })
    const seen: unknown[] = []
    const stop = registry.components.Recover.subscribe((value) => seen.push(value))

    const failedA = registry.ensure('Recover')
    const failedB = registry.ensure('Recover')
    expect(failedA).toBe(failedB)
    await expect(failedA).rejects.toBe(error)
    await expect(failedB).rejects.toBe(error)
    expect(get(registry.components.Recover)).toBeNull()
    expect(seen).toEqual([null])

    await registry.ensure('Recover')

    expect(loader).toHaveBeenCalledTimes(2)
    expect(seen).toEqual([null, component])
    stop()
  })

  it('keeps components independent: loading one does not touch another store or its pending load', async () => {
    const install = { name: 'Install' }
    const admin = { name: 'Admin' }
    const adminLoad = deferred<Module<typeof admin>>()
    const adminLoader = vi.fn(() => adminLoad.promise)
    const installLoader = vi.fn(async () => ({ default: install }))
    const registry = createLazyComponentRegistry({ Admin: adminLoader, Install: installLoader })
    const installSeen: unknown[] = []
    const stop = registry.components.Install.subscribe((value) => installSeen.push(value))

    const adminPending = registry.ensure('Admin')
    await registry.ensure('Install')
    expect(get(registry.components.Admin)).toBeNull()

    adminLoad.resolve({ default: admin })
    await adminPending

    expect(get(registry.components.Admin)).toBe(admin)
    // Admin 加载完成不会让 Install 的 store 再推送一次（App 的 `$:` 不会因此重跑）。
    expect(installSeen).toEqual([null, install])
    expect(adminLoader).toHaveBeenCalledTimes(1)
    expect(installLoader).toHaveBeenCalledTimes(1)
    stop()
  })

  it('exposes read-only stores', () => {
    const registry = createLazyComponentRegistry({ Admin: async () => ({ default: {} }) })
    expect(Object.keys(registry.components.Admin)).toEqual(['subscribe'])
  })
})
