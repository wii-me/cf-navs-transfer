// 图标本地优先缓存（v2）。
//
// - 所有对象图标（书签 /api/icon/:id、分类 /api/category-icon/:id，公开与私密）成功取到真实图片后
//   存进一个 IndexedDB 库；匿名访客同样持久化。没有总量上限和 LRU，只受浏览器配额约束。
// - 条目按对象键（bookmark:12 / category:3）存一份，附带「版本」：去掉 `key` 授权参数后的代理 URL。
//   URL 里的 v= 已包含 icon_revision / icon_write_epoch / 来源 / 标题等，任何一项变化版本即不同，
//   显示时版本不一致就重新下载并覆盖。
// - 服务端全局标志位（dataset_epoch + icon_epoch，随 /api/data/version 与数据包返回）变化时，
//   对照当前数据清理已不存在 / 不再可见的对象条目；标志位不变时不扫描。
// - 兜底：单张图 > 512 KiB 只显示不落盘；首次写入时申请持久存储；配额满或 IndexedDB 不可用时
//   退回内存（本页有效），不报错。登出（会话消失）时只删除私密条目。

import { fetchScheduledObjectIconPayload } from './localBookmarkIconCache'

export const ICON_LOCAL_DB_NAME = 'cf-navs-icons-v2'
export const ICON_LOCAL_MAX_BYTES = 512 * 1024
const DB_VERSION = 1
const ICON_STORE = 'icons'
const META_STORE = 'meta'
const EPOCH_META_KEY = 'epoch'
/** localStorage 提示位：'1' = 本地库里（可能）有图标；不存在 = 从未写入过（首次访问）。 */
export const ICON_LOCAL_HINT_KEY = 'cf-navs-icons-v2:has-entries'
/** 打开并读出本地库的最长等待；超时（个别浏览器 open 永不回调）退回内存，本页照常下载。 */
export const ICON_LOCAL_READY_TIMEOUT_MS = 3000

export type IconObjectType = 'bookmark' | 'category'

export interface LocalIconEntry {
  key: string
  version: string
  private: boolean
  blob: Blob
  saved_at: number
}

export interface IconFetchPayload {
  blob: Blob | null
  status: 'ready' | 'retryable' | 'unavailable'
}

export interface IconLocalBackend {
  loadAll(): Promise<{ entries: LocalIconEntry[]; epoch: string | null }>
  put(entry: LocalIconEntry): Promise<void>
  delete(keys: string[]): Promise<void>
  setEpoch(epoch: string): Promise<void>
}

export class IconQuotaError extends Error {}

/** 本地库是否有内容的同步提示。get 返回 null 表示未知（读不到 localStorage），按「可能有」处理。 */
export interface IconLocalHint {
  get(): boolean | null
  set(hasEntries: boolean): void
}

export function createLocalStorageIconHint(key = ICON_LOCAL_HINT_KEY): IconLocalHint {
  return {
    get() {
      try {
        if (typeof localStorage === 'undefined') return null
        return localStorage.getItem(key) === '1'
      } catch {
        return null
      }
    },
    set(hasEntries) {
      try {
        if (typeof localStorage === 'undefined') return
        if (hasEntries) localStorage.setItem(key, '1')
        else localStorage.removeItem(key)
      } catch {
        // 存储被禁用：提示位只是优化，失败时下次照旧等待本地库。
      }
    },
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error?.name === 'QuotaExceededError' ? new IconQuotaError('quota') : tx.error)
    tx.onerror = () => reject(tx.error?.name === 'QuotaExceededError' ? new IconQuotaError('quota') : tx.error)
  })
}

export function createIndexedDbIconBackend(name = ICON_LOCAL_DB_NAME): IconLocalBackend | null {
  if (typeof indexedDB === 'undefined') return null
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(ICON_STORE)) db.createObjectStore(ICON_STORE, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); dbPromise = null }
        resolve(db)
      }
      request.onerror = () => { dbPromise = null; reject(request.error) }
      request.onblocked = () => { dbPromise = null; reject(new Error('icon database blocked')) }
    })
    return dbPromise
  }
  return {
    async loadAll() {
      const db = await open()
      const tx = db.transaction([ICON_STORE, META_STORE], 'readonly')
      const [entries, epoch] = await Promise.all([
        requestToPromise(tx.objectStore(ICON_STORE).getAll() as IDBRequest<LocalIconEntry[]>),
        requestToPromise(tx.objectStore(META_STORE).get(EPOCH_META_KEY) as IDBRequest<string | undefined>),
      ])
      return { entries: entries ?? [], epoch: typeof epoch === 'string' ? epoch : null }
    },
    async put(entry) {
      const db = await open()
      const tx = db.transaction(ICON_STORE, 'readwrite')
      tx.objectStore(ICON_STORE).put(entry)
      await transactionDone(tx)
    },
    async delete(keys) {
      if (!keys.length) return
      const db = await open()
      const tx = db.transaction(ICON_STORE, 'readwrite')
      const store = tx.objectStore(ICON_STORE)
      for (const key of keys) store.delete(key)
      await transactionDone(tx)
    },
    async setEpoch(epoch) {
      const db = await open()
      const tx = db.transaction(META_STORE, 'readwrite')
      tx.objectStore(META_STORE).put(epoch, EPOCH_META_KEY)
      await transactionDone(tx)
    },
  }
}

export function iconObjectKey(type: IconObjectType, id: number): string {
  return type + ':' + id
}

/** 去掉授权参数 `key`：同一对象的公开 / 私密访问共享一份版本身份。 */
export function iconVersionFromUrl(url: string): string {
  const [path, query = ''] = url.split('?', 2)
  if (!query) return path
  const kept = query.split('&').filter(part => part && !part.startsWith('key='))
  return kept.length ? path + '?' + kept.join('&') : path
}

export function iconUrlHasAccessKey(url: string): boolean {
  const query = url.split('?', 2)[1] ?? ''
  return query.split('&').some(part => part.startsWith('key='))
}

interface StoreOptions {
  backend: IconLocalBackend | null
  fetchPayload: (url: string) => Promise<IconFetchPayload>
  createUrl?: (blob: Blob) => string
  revokeUrl?: (url: string) => void
  requestPersist?: () => Promise<unknown>
  hint?: IconLocalHint | null
  readyTimeoutMs?: number
  now?: () => number
  warn?: (message: string, error: unknown) => void
}

interface MemoryEntry extends LocalIconEntry { url: string | null }

export function createIconLocalStore(options: StoreOptions) {
  const createUrl = options.createUrl ?? (blob => URL.createObjectURL(blob))
  const revokeUrl = options.revokeUrl ?? (url => URL.revokeObjectURL(url))
  const now = options.now ?? Date.now
  const warn = options.warn ?? ((message, error) => console.warn('[CF-Navs] ' + message, error))
  let backend = options.backend
  const hint = options.hint ?? null
  const readyTimeoutMs = options.readyTimeoutMs ?? ICON_LOCAL_READY_TIMEOUT_MS
  // 首次访问（提示位明确为「没写过」）时，下载不必等本地库打开：库里不可能有可用条目。
  const skipReadyWait = Boolean(backend) && hint?.get() === false
  let hintSet = false
  const memory = new Map<string, MemoryEntry>()
  const inflight = new Map<string, Promise<string | null>>()
  let storedEpoch: string | null = null
  let loaded = false
  let persistRequested = false
  // 内存层与磁盘层的代次：clear/prune 之后，早先发起的写入不能把已删除的条目写回。
  let generation = 0

  const ready: Promise<void> = (async () => {
    if (!backend) { loaded = true; return }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('icon local store open timed out')), readyTimeoutMs)
      })
      const { entries, epoch } = await Promise.race([backend.loadAll(), timeout])
      storedEpoch = epoch
      for (const entry of entries) {
        if (entry && typeof entry.key === 'string' && typeof entry.version === 'string' && entry.blob instanceof Blob && !memory.has(entry.key)) {
          memory.set(entry.key, { ...entry, private: Boolean(entry.private), url: null })
        }
      }
    } catch (error) {
      warn('icon local store unavailable; using memory only', error)
      backend = null
    } finally {
      clearTimeout(timer)
      loaded = true
    }
  })()

  function urlOf(entry: MemoryEntry): string {
    entry.url ??= createUrl(entry.blob)
    return entry.url
  }

  function drop(key: string): void {
    const entry = memory.get(key)
    if (!entry) return
    memory.delete(key)
    if (entry.url) revokeUrl(entry.url)
  }

  function persistDelete(keys: string[]): void {
    if (!backend || !keys.length) return
    void backend.delete(keys).catch(error => warn('icon local delete failed', error))
  }

  /** 同步命中（已加载且版本一致）。未加载完成时返回 null，调用方走 resolve。 */
  function peek(key: string, version: string): string | null {
    if (!loaded) return null
    const entry = memory.get(key)
    return entry && entry.version === version ? urlOf(entry) : null
  }

  async function store(key: string, version: string, isPrivate: boolean, blob: Blob): Promise<string> {
    const own = generation
    const previous = memory.get(key)
    if (previous && previous.version === version) return urlOf(previous)
    drop(key)
    const entry: MemoryEntry = { key, version, private: isPrivate, blob, saved_at: now(), url: null }
    memory.set(key, entry)
    const url = urlOf(entry)
    if (backend && blob.size <= ICON_LOCAL_MAX_BYTES) {
      if (!persistRequested) {
        persistRequested = true
        void (options.requestPersist?.() ?? Promise.resolve()).catch(() => undefined)
      }
      const { url: _url, ...record } = entry
      const target = backend
      // 落盘不阻塞显示：先把 blob URL 交给页面，写入在后台完成。
      void (async () => {
        try {
          if (own === generation && memory.get(key) === entry) {
            await target.put(record)
            if (!hintSet) { hintSet = true; hint?.set(true) }
          }
          // put 落盘期间被 clear/prune 删掉了：把磁盘上的这条也删掉。
          if (own !== generation && memory.get(key) !== entry) persistDelete([key])
        } catch (error) {
          // 配额满 / 写失败：保留内存副本，本页继续使用，不打扰用户。
          if (!(error instanceof IconQuotaError)) warn('icon local write failed', error)
        }
      })()
    }
    return url
  }

  /** 本地有同版本就直接返回；否则下载一次（同键同版本合并），成功的真实图片落盘。 */
  async function resolve(key: string, version: string, fetchUrl: string, isPrivate: boolean): Promise<string | null> {
    if (!skipReadyWait) await ready
    const hit = peek(key, version)
    if (hit) return hit
    const id = key + '\n' + version + '\n' + (isPrivate ? 'p' : 'a')
    let pending = inflight.get(id)
    if (!pending) {
      pending = (async () => {
        try {
          const payload = await options.fetchPayload(fetchUrl)
          if (payload.status !== 'ready' || !payload.blob) return null
          return await store(key, version, isPrivate, payload.blob)
        } catch {
          return null
        } finally {
          inflight.delete(id)
        }
      })()
      inflight.set(id, pending)
    }
    return pending
  }

  /** 已发布的本地图片解码失败：删掉这一条，下次显示重新下载。 */
  function invalidate(key: string, version?: string): void {
    const entry = memory.get(key)
    if (!entry || (version !== undefined && entry.version !== version)) return
    drop(key)
    persistDelete([key])
  }

  async function clearPrivate(): Promise<void> {
    await ready
    generation++
    const keys = [...memory.values()].filter(entry => entry.private).map(entry => entry.key)
    for (const key of keys) drop(key)
    if (backend && keys.length) await backend.delete(keys).catch(error => warn('icon local private cleanup failed', error))
  }

  /**
   * 服务端标志位与上次记录不同时，删除当前数据里已不存在的对象条目（含匿名视角下变成私密的），
   * 然后记录新标志位。标志位相同直接返回（不扫描）。返回是否执行了清理。
   */
  async function reconcile(epoch: string, liveKeys: ReadonlySet<string>): Promise<boolean> {
    await ready
    if (!epoch || epoch === storedEpoch) return false
    generation++
    const stale = [...memory.keys()].filter(key => !liveKeys.has(key))
    for (const key of stale) drop(key)
    storedEpoch = epoch
    if (backend) {
      try {
        if (stale.length) await backend.delete(stale)
        await backend.setEpoch(epoch)
      } catch (error) {
        warn('icon local reconcile failed', error)
      }
    }
    return true
  }

  return {
    ready,
    peek,
    resolve,
    invalidate,
    clearPrivate,
    reconcile,
    epoch: () => storedEpoch,
    size: () => memory.size,
  }
}

export type IconLocalStore = ReturnType<typeof createIconLocalStore>

let defaultStore: IconLocalStore | null = null

export function iconLocalStore(): IconLocalStore {
  defaultStore ??= createIconLocalStore({
    backend: createIndexedDbIconBackend(),
    hint: createLocalStorageIconHint(),
    // 复用普通对象图标的有界调度器（并发 4、同 URL 合并、10s 超时）。
    fetchPayload: fetchScheduledObjectIconPayload,
    requestPersist: () => (typeof navigator !== 'undefined' && navigator.storage?.persist ? navigator.storage.persist() : Promise.resolve(false)),
  })
  return defaultStore
}

/** 启动时调用：提前打开并读出本地库，与数据包请求、首屏渲染并行，而不是等第一个图标出现。 */
export function warmIconLocalStore(): void {
  void iconLocalStore().ready
}

/** 由数据包或 /data/version 带回的元数据组成标志位；缺字段（旧服务端）返回空串，不触发清理。 */
export function iconEpochToken(metadata: { dataset_epoch?: string; icon_epoch?: number }, scope: 'anonymous' | 'admin'): string {
  if (!metadata.dataset_epoch || !Number.isSafeInteger(metadata.icon_epoch)) return ''
  return `${metadata.dataset_epoch}:${metadata.icon_epoch}:${scope}`
}
