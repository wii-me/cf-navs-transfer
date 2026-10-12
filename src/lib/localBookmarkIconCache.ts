import { CURRENT_EXTERNAL_ICON_CACHE_NAME, LEGACY_ICON_LOCAL_STORAGE_PREFIX } from './legacyIconCopyMigration'
import { createOrdinaryIconScheduler } from './ordinaryIconScheduler'

const CACHE_NAME = CURRENT_EXTERNAL_ICON_CACHE_NAME
const MAX_LOCAL_ICON_CACHE_BYTES = 512 * 1024
const CACHE_ORIGIN = 'https://cf-navs.local'
const CACHE_PATH_PREFIX = '/bookmark-icon/'
const TRANSIENT_OBJECT_ICON_TTL_MS = 30_000
// Short-term public completed-blob reuse window. The cap must exceed the public object-icon set a
// home can mount (card-count gate is >=300; production ~355) so first-loaded above-the-fold icons
// are not evicted mid-scroll and then re-fetched on cross-phase remount (search-clear / view
// switch). Entries are small object-icon blobs bounded by the 30s TTL. Raised from 64 (which held
// only a fraction of the mounted set, forcing C-5 /api/icon re-fetches) to cover the full page.
const MAX_TRANSIENT_OBJECT_ICONS = 512

export type BookmarkIconCacheInput = {
  id: string | number
  icon: string
  iconSource?: string | null
}

function canUseCacheStorage(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

function isObjectIconProxyUrl(url: string): boolean {
  if (url.startsWith('/api/icon/')) return true
  try {
    const parsed = new URL(url)
    return typeof location !== 'undefined' && parsed.origin === location.origin && parsed.pathname.startsWith('/api/icon/')
  } catch {
    return false
  }
}

function createHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(36)
}

function cacheRequest(cacheKey: string): Request {
  return new Request(`${CACHE_ORIGIN}${CACHE_PATH_PREFIX}${encodeURIComponent(cacheKey)}`, {
    method: 'GET',
  })
}

function bookmarkCacheKeyPrefix(cacheKey: string): string | null {
  const separatorIndex = cacheKey.indexOf('-')
  if (separatorIndex <= 0) return null
  return cacheKey.slice(0, separatorIndex + 1)
}

function isBookmarkIconCacheRequest(request: Request, cacheKeyPrefix: string): boolean {
  try {
    const url = new URL(request.url)
    return (
      url.origin === CACHE_ORIGIN &&
      url.pathname.startsWith(`${CACHE_PATH_PREFIX}${encodeURIComponent(cacheKeyPrefix)}`)
    )
  } catch {
    return false
  }
}

async function deleteStaleCacheStorageEntries(cache: Cache, cacheKey: string): Promise<void> {
  const cacheKeyPrefix = bookmarkCacheKeyPrefix(cacheKey)
  if (!cacheKeyPrefix) return

  const currentUrl = cacheRequest(cacheKey).url
  const requests = await cache.keys()
  await Promise.all(
    requests.map((request) => (
      request.url !== currentUrl && isBookmarkIconCacheRequest(request, cacheKeyPrefix)
        ? cache.delete(request)
        : Promise.resolve(false)
    )),
  )
}

async function responseToIconBlob(response: Response): Promise<Blob | null> {
  if (!response.ok) return null

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('image/')) return null

  const blob = await response.blob()
  return blob.size > 0 ? blob : null
}

function responseToObjectUrl(response: Response): Promise<string | null> {
  return responseToIconBlob(response).then((blob) => (blob ? URL.createObjectURL(blob) : null))
}

// 「经常访问」与普通分类会把同一本书签各挂一个 BookmarkCard，同一 tick 内对同一条对象代理
// URL 发两次 fetch。对象图标是 no-store、不持久化，所以只能合并**在途**请求，不缓存完成结果：
// 按完整 URL（含 v/cv/key）索引，拿到同一份正文后各自生成独立 object URL，成功或失败都立即移除，
// 下一次挂载重新经过可见性闸门。
export type BookmarkIconFetchResult = {
  url: string | null
  status: 'ready' | 'retryable' | 'unavailable'
}

type IconPayload = { blob: Blob | null; status: BookmarkIconFetchResult['status'] }

async function responseToIconPayload(response: Response): Promise<IconPayload> {
  if (!response.ok) {
    return { blob: null, status: response.status === 408 || response.status === 429 || response.status >= 500 ? 'retryable' : 'unavailable' }
  }
  const blob = await responseToIconBlob(response)
  // A 200 fallback is displayable, but must not stop recovery as if it were the
  // real icon. Object responses are all no-store, so retries must remain bounded.
  return { blob, status: response.headers.get('X-Icon-Fallback') === '1' || !blob ? 'retryable' : 'ready' }
}

// Chosen by the IP-P2 controlled concurrency experiment (local home355 fixture, CDP-throttled
// 150ms / 1.6Mbps): N=4 gave the lowest cold first-view-ready (p50 1979ms vs 2141/2813 at 6/8) and
// the least scroll jank, 0 failed / 0 broken, beating the unbounded ~212-concurrent burst on every
// measured axis. A session may override via globalThis.__CF_NAVS_ICON_CONCURRENCY for experiments.
const DEFAULT_ORDINARY_ICON_CONCURRENCY = 4

function initialOrdinaryIconConcurrency(): number {
  const scope: object = globalThis
  const override: unknown = '__CF_NAVS_ICON_CONCURRENCY' in scope ? scope.__CF_NAVS_ICON_CONCURRENCY : undefined
  return typeof override === 'number' && Number.isInteger(override) && override >= 1 ? override : DEFAULT_ORDINARY_ICON_CONCURRENCY
}

// One bounded scheduler owns ordinary same-origin /api/icon/ transmission. It preserves the existing
// full-URL in-flight coalescing (one run per URL, shared payload, per-caller object URL) and caps
// simultaneous network fetches so a full scroll no longer fires 200+ concurrent requests. The 10s
// deadline starts only once a slot begins the run; queue waiting never consumes it.
const objectIconScheduler = createOrdinaryIconScheduler<IconPayload>({
  concurrency: initialOrdinaryIconConcurrency(),
  run: (url, signal) => fetchObjectIconPayload(url, signal),
})
const transientObjectIcons = new Map<string, { blob: Blob; expiresAt: number }>()
const OBJECT_ICON_TIMEOUT_MS = 10000

function isPublicObjectIconUrl(url: string): boolean {
  try {
    return !new URL(url, typeof location !== 'undefined' ? location.href : CACHE_ORIGIN).searchParams.has('key')
  } catch {
    return false
  }
}

function readTransientObjectIcon(url: string): Blob | null {
  const cached = transientObjectIcons.get(url)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    transientObjectIcons.delete(url)
    return null
  }
  transientObjectIcons.delete(url)
  transientObjectIcons.set(url, cached)
  return cached.blob
}

function writeTransientObjectIcon(url: string, blob: Blob): void {
  transientObjectIcons.delete(url)
  transientObjectIcons.set(url, { blob, expiresAt: Date.now() + TRANSIENT_OBJECT_ICON_TTL_MS })
  while (transientObjectIcons.size > MAX_TRANSIENT_OBJECT_ICONS) {
    transientObjectIcons.delete(transientObjectIcons.keys().next().value as string)
  }
}

async function fetchObjectIconPayload(url: string, externalSignal?: AbortSignal): Promise<IconPayload> {
  const controller = new AbortController()
  const abortFromExternal = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Object icon response timed out', 'TimeoutError')
      reject(error)
      controller.abort(error)
    }, OBJECT_ICON_TIMEOUT_MS)
  })
  try {
    // The deadline includes the response body and only starts once the scheduler grants a slot.
    // A headers-only success must not retain this URL's shared run forever and prevent recovery.
    return await Promise.race([
      fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal: controller.signal }).then(responseToIconPayload),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal)
  }
}

async function fetchObjectIcon(url: string, reuseCompleted = false): Promise<BookmarkIconFetchResult> {
  // Public completed blobs are still reused within the short in-memory window; otherwise the bounded
  // scheduler coalesces the full URL (one run, shared payload) and caps simultaneous network fetches.
  if (reuseCompleted && isPublicObjectIconUrl(url)) {
    const blob = readTransientObjectIcon(url)
    if (blob) return { url: URL.createObjectURL(blob), status: 'ready' }
  }
  try {
    const { blob, status } = await objectIconScheduler.reserve(url).promise
    if (reuseCompleted && status === 'ready' && blob && isPublicObjectIconUrl(url)) writeTransientObjectIcon(url, blob)
    return { url: blob ? URL.createObjectURL(blob) : null, status }
  } catch {
    return { url: null, status: 'retryable' }
  }
}


export function createBookmarkIconCacheKey(input: BookmarkIconCacheInput): string {
  return `${input.id}-${createHash(`${input.iconSource ?? ''}:${input.icon}`)}`
}

export function isDataImage(value: string): boolean {
  return /^data:image\//i.test(value.trim())
}

export function revokeLocalIconUrl(value: string): void {
  if (value.startsWith('blob:')) {
    URL.revokeObjectURL(value)
  }
}

export function readCachedBookmarkIconDataUri(cacheKey: string): string | null {
  void cacheKey
  return null
}

export async function readCachedBookmarkIconUrl(cacheKey: string): Promise<string | null> {
  if (!canUseCacheStorage()) return null

  try {
    const cache = await caches.open(CACHE_NAME)
    const request = cacheRequest(cacheKey)
    const cached = await cache.match(request)
    const cacheControl = cached?.headers.get('cache-control')?.toLowerCase() ?? ''
    const canPersist = cached !== undefined && cached.headers.get('X-Icon-Fallback') !== '1' && !/\bno-store\b/.test(cacheControl)
    if (!canPersist) {
      if (cached) await cache.delete(request)
      return null
    }
    return await responseToObjectUrl(cached)
  } catch {
    return null
  }
}

export async function deleteCachedBookmarkIcon(cacheKey: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      window.localStorage.removeItem(`${LEGACY_ICON_LOCAL_STORAGE_PREFIX}${cacheKey}`)
    }
  } catch {
    // Best-effort cleanup.
  }

  if (!canUseCacheStorage()) return

  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.delete(cacheRequest(cacheKey))
  } catch {
    // Best-effort cleanup.
  }
}

export async function writeBookmarkIconDataUri(cacheKey: string, dataUri: string): Promise<void> {
  if (!isDataImage(dataUri)) return
  await deleteCachedBookmarkIcon(cacheKey)
}

export async function fetchBookmarkIcon(
  cacheKey: string,
  url: string,
  options: { reuseCompletedObject?: boolean } = {},
): Promise<BookmarkIconFetchResult> {
  if (!url) return { url: null, status: 'unavailable' }

  try {
    if (isObjectIconProxyUrl(url)) return await fetchObjectIcon(url, options.reuseCompletedObject)
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'force-cache',
    })
    if (!response.ok) return { url: null, status: response.status >= 500 || response.status === 429 || response.status === 408 ? 'retryable' : 'unavailable' }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) return { url: null, status: 'unavailable' }

    const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? ''
    const contentLengthHeader = response.headers.get('content-length')
    const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader)
    const canPersist =
      Number.isFinite(contentLength) &&
      contentLength >= 0 &&
      contentLength <= MAX_LOCAL_ICON_CACHE_BYTES &&
      response.headers.get('X-Icon-Fallback') !== '1' &&
      !isObjectIconProxyUrl(url) &&
      !/\bno-store\b/.test(cacheControl)
    if (canUseCacheStorage() && canPersist) {
      const cache = await caches.open(CACHE_NAME)
      await deleteStaleCacheStorageEntries(cache, cacheKey)
      await cache.put(cacheRequest(cacheKey), response.clone())
    }

    const { blob, status } = await responseToIconPayload(response)
    return { url: blob ? URL.createObjectURL(blob) : null, status }
  } catch {
    return { url: null, status: 'retryable' }
  }
}

export interface FetchCachedIconResult {
  url: string | null
  stale: boolean
}

export async function fetchCachedBookmarkIconUrl(
  cacheKey: string,
  requestSeq: { current: number },
): Promise<FetchCachedIconResult> {
  const seq = ++requestSeq.current
  const url = await readCachedBookmarkIconUrl(cacheKey)
  if (seq !== requestSeq.current) {
    if (url) revokeLocalIconUrl(url)
    return { url: null, stale: true }
  }
  return { url, stale: false }
}
