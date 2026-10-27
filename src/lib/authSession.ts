import type { LoginResp } from '../../shared/types'

// 浏览器里的登录会话：localStorage 持久化、进程内缓存、跨标签页 `storage` 事件。
// 只管「存了哪个会话」，不发请求、不碰图标设备或 store；会话结束时要做的清理
// （图标访问 key、设备副本退出）由 appServices 在启动时接到 authStore 的生命周期钩子上。

export interface StoredAuthSession extends LoginResp { }

export const AUTH_STORAGE_KEY = 'cf-navs.auth'
const browserStorageSubscribers = new Set<(key: string | null) => void>()
export function notifyBrowserStorageChange(key: string | null): void {
  for (const listener of browserStorageSubscribers) listener(key)
}
export function subscribeBrowserStorageChanges(listener: (key: string | null) => void): () => void {
  ensureAuthStorageListener()
  browserStorageSubscribers.add(listener)
  return () => browserStorageSubscribers.delete(listener)
}
export function refreshStoredAuthSession(): void {
  cachedAuthSession = undefined
  notifyBrowserStorageChange(AUTH_STORAGE_KEY)
}

let cachedAuthSession: StoredAuthSession | null | undefined = undefined
let authStorageListenerAttached = false

function isBrowser() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function ensureAuthStorageListener(): void {
  if (!isBrowser() || authStorageListenerAttached) {
    return
  }

  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_STORAGE_KEY || event.key === null) cachedAuthSession = undefined
    notifyBrowserStorageChange(event.key)
  })
  authStorageListenerAttached = true
}

function normalizeStoredAuthSession(value: unknown): StoredAuthSession | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<StoredAuthSession>
  if (typeof candidate.token !== 'string' || typeof candidate.expires_at !== 'number') {
    return null
  }

  if (candidate.expires_at <= Date.now()) {
    return null
  }

  return {
    token: candidate.token,
    expires_at: candidate.expires_at,
    username: typeof candidate.username === 'string' ? candidate.username : '',
  }
}


export function getStoredAuthSession(): StoredAuthSession | null {
  if (!isBrowser()) {
    return null
  }

  ensureAuthStorageListener()

  if (cachedAuthSession === null) return null
  if (cachedAuthSession !== undefined) {
    const session = normalizeStoredAuthSession(cachedAuthSession)
    if (!session) {
      clearStoredAuthSession()
    }
    return session
  }

  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) {
    cachedAuthSession = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    const session = normalizeStoredAuthSession(parsed)
    if (!session) {
      clearStoredAuthSession()
      return null
    }
    cachedAuthSession = session
    return session
  } catch {
    clearStoredAuthSession()
    return null
  }
}

export function setStoredAuthSession(session: StoredAuthSession): void {
  cachedAuthSession = session
  if (!isBrowser()) {
    return
  }

  ensureAuthStorageListener()
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
  notifyBrowserStorageChange(AUTH_STORAGE_KEY)
}

export function clearStoredAuthSession(): void {
  cachedAuthSession = null
  if (!isBrowser()) {
    return
  }

  ensureAuthStorageListener()
  localStorage.removeItem(AUTH_STORAGE_KEY)
  notifyBrowserStorageChange(AUTH_STORAGE_KEY)
}

export function getAuthToken(): string | null {
  return getStoredAuthSession()?.token ?? null
}
