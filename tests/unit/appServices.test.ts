import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  clearPrivate: vi.fn(),
  clearIconAccessKey: vi.fn(),
  recordMutationDataVersion: vi.fn(),
  logout: vi.fn(),
  versionListener: null as ((version: string) => void) | null,
}))

vi.mock('../../src/lib/iconLocalStore', () => ({
  iconLocalStore: () => ({ clearPrivate: () => { h.calls.push('clearPrivate'); h.clearPrivate(); return Promise.resolve() } }),
}))
vi.mock('../../src/lib/iconAccessKey', () => ({
  clearIconAccessKey: () => { h.calls.push('clearIconAccessKey'); h.clearIconAccessKey() },
}))
vi.mock('../../src/lib/dataService', () => ({ recordMutationDataVersion: h.recordMutationDataVersion }))
vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    authApi: { ...actual.authApi, logout: () => { h.calls.push('authApi.logout'); return h.logout() } },
    subscribeMutationDataVersion: (listener: (version: string) => void) => { h.versionListener = listener; return () => { h.versionListener = null } },
  }
})

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length(): number { return this.items.size }
  clear(): void { this.items.clear() }
  getItem(key: string): string | null { return this.items.get(key) ?? null }
  key(index: number): string | null { return Array.from(this.items.keys())[index] ?? null }
  removeItem(key: string): void { this.items.delete(key) }
  setItem(key: string, value: string): void { this.items.set(key, value) }
}

const session = () => ({ token: 'tok', expires_at: Date.now() + 600_000, username: 'admin' })

async function load() {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { origin: 'https://navs.example.test' }, addEventListener: () => {} })
  vi.resetModules()
  const services = await import('../../src/lib/appServices')
  const stores = await import('../../src/lib/stores')
  const authSession = await import('../../src/lib/authSession')
  return { services, stores, authSession }
}

beforeEach(() => {
  h.calls.length = 0
  h.versionListener = null
  for (const fn of [h.clearPrivate, h.clearIconAccessKey, h.recordMutationDataVersion, h.logout]) fn.mockReset()
  h.logout.mockResolvedValue({ revoked: true })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('appServices wiring', () => {
  it('authStore runs no icon side effects until initAppServices wires it', async () => {
    const { stores } = await load()
    stores.authStore.setSession(session())
    await stores.authStore.logout()
    expect(h.clearPrivate).not.toHaveBeenCalled()
    expect(h.clearIconAccessKey).not.toHaveBeenCalled()
  })

  it('logout clears private local icons before the revoke request, then clears the icon key', async () => {
    const { services, stores } = await load()
    services.initAppServices()
    stores.authStore.setSession(session())
    h.calls.length = 0
    await stores.authStore.logout()
    expect(h.calls[0]).toBe('clearPrivate')
    expect(h.calls.indexOf('authApi.logout')).toBeGreaterThan(0)
    expect(h.calls.lastIndexOf('clearIconAccessKey')).toBeGreaterThan(h.calls.indexOf('authApi.logout'))
    expect(h.clearPrivate).toHaveBeenCalledTimes(1)
  })

  it('clears the icon key when the stored session disappears (401 or another tab)', async () => {
    const { services, stores, authSession } = await load()
    services.initAppServices()
    stores.authStore.setSession(session())
    h.clearIconAccessKey.mockClear()
    authSession.clearStoredAuthSession()
    expect(h.clearIconAccessKey).toHaveBeenCalled()
    expect(h.clearPrivate).not.toHaveBeenCalled()
  })

  it('forwards write-envelope data versions to dataService and stops on reset', async () => {
    const { services } = await load()
    expect(h.versionListener).toBeNull()
    services.initAppServices()
    h.versionListener?.('v42')
    expect(h.recordMutationDataVersion).toHaveBeenCalledWith('v42')
    services.resetAppServicesForTest()
    expect(h.versionListener).toBeNull()
  })

  it('is idempotent and can be reset', async () => {
    const { services, stores } = await load()
    services.initAppServices()
    services.initAppServices()
    stores.authStore.setSession(session())
    await stores.authStore.logout()
    expect(h.clearPrivate).toHaveBeenCalledTimes(1)
    services.resetAppServicesForTest()
    stores.authStore.setSession(session())
    await stores.authStore.logout()
    expect(h.clearPrivate).toHaveBeenCalledTimes(1)
    services.initAppServices()
    stores.authStore.setSession(session())
    await stores.authStore.logout()
    expect(h.clearPrivate).toHaveBeenCalledTimes(2)
  })
})

describe('state-layer boundaries (source guard)', () => {
  const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')

  it('stores.ts does not reach into icon modules', () => {
    expect(src('lib/stores.ts')).not.toMatch(/from '\.\/(iconLocalStore|iconAccessKey)'/)
  })

  it('api.ts no longer owns session persistence', () => {
    const api = src('lib/api.ts')
    expect(api).not.toMatch(/localStorage/)
    expect(api).not.toMatch(/export const AUTH_STORAGE_KEY/)
  })

  it('main.ts wires services before mount', () => {
    const main = src('main.ts')
    expect(main.indexOf('initAppServices()')).toBeGreaterThan(-1)
    expect(main.indexOf('initAppServices()')).toBeLessThan(main.indexOf('mount(App'))
  })
})
