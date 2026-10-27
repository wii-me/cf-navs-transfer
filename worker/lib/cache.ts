const PUBLIC_DATA_CACHE_PATH = '/api/public/data'
const PUBLIC_DATA_BROWSER_TTL = 30
const PUBLIC_DATA_EDGE_TTL = 120
const PRIVATE_PUBLIC_DATA_EDGE_TTL = 60
const SITE_CONFIG_CACHE_PATH = '/api/config'
const SITE_CONFIG_BROWSER_TTL = 15
const SITE_CONFIG_EDGE_TTL = 60

function normalizedCacheRequest(urlLike: string, pathname: string): Request {
  const url = new URL(urlLike)
  url.pathname = pathname
  url.search = ''
  return new Request(url.toString(), { method: 'GET' })
}

// 版本号来自 `/api/data/version`：触发器写入 32 位 hex，Worker 写入 base36 时间戳-随机串，
// 兼容旧值 '0' / 数字。格式不符的 `v` 一律当作未带版本，防止任意字符串撑大缓存键空间。
const PUBLIC_DATA_VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 读取 `/api/public/data?v=<data_version>` 的版本参数；缺失或格式非法返回 null。 */
export function parsePublicDataVersion(requestUrl: string): string | null {
  const value = new URL(requestUrl).searchParams.get('v')
  return value && PUBLIC_DATA_VERSION_PATTERN.test(value) ? value : null
}

/**
 * 公开数据缓存键：路径固定，查询串只保留规范化后的 `v`。
 * `version === null` 是旧客户端使用的无版本键（也是写操作失效的那一个）；
 * 带版本键的内容与版本一一对应，版本前进后旧键自然不可达，不依赖逐 colo 的 delete。
 */
function publicDataCacheRequest(urlLike: string, version: string | null = null): Request {
  const request = normalizedCacheRequest(urlLike, PUBLIC_DATA_CACHE_PATH)
  if (!version) return request
  const url = new URL(request.url)
  url.searchParams.set('v', version)
  return new Request(url.toString(), { method: 'GET' })
}

function siteConfigCacheRequest(urlLike: string): Request {
  return normalizedCacheRequest(urlLike, SITE_CONFIG_CACHE_PATH)
}

function edgeCache(): Cache {
  return (caches as unknown as { default: Cache }).default
}

function waitUntil(c: unknown, promise: Promise<unknown>): void {
  // Hono 的 `c.executionCtx` 在没有 ExecutionContext 时会抛错（单测 / 非 Workers 运行时），
  // 缓存写入与失效都是尽力而为，不能因此让请求失败。
  let executionCtx: ExecutionContext | undefined
  try {
    executionCtx = (c as { executionCtx?: ExecutionContext }).executionCtx
  } catch {
    executionCtx = undefined
  }
  // 失败只记日志：边缘缓存不可用时请求照常回源，但要能在 Workers 日志里看到。
  const observed = promise.catch((error) => {
    console.warn('[edge-cache] best-effort cache operation failed:', error)
  })
  if (executionCtx) executionCtx.waitUntil(observed)
}

export async function matchPublicDataCache(requestUrl: string, version: string | null = null): Promise<Response | undefined> {
  return await edgeCache().match(publicDataCacheRequest(requestUrl, version))
}

export async function matchSiteConfigCache(requestUrl: string): Promise<Response | undefined> {
  return await edgeCache().match(siteConfigCacheRequest(requestUrl))
}

export const PUBLIC_DATA_CACHE_CONTROL =
  `public, max-age=${PUBLIC_DATA_BROWSER_TTL}, s-maxage=${PUBLIC_DATA_EDGE_TTL}, stale-while-revalidate=300`

export function cachePublicDataResponse(
  c: unknown,
  requestUrl: string,
  response: Response,
  version: string | null = null,
): void {
  // 缓存副本总是写公开头；返回给客户端的那份可以是 no-store（例如请求的 v 已过期）。
  const cached = new Response(response.clone().body, response)
  cached.headers.set('Cache-Control', PUBLIC_DATA_CACHE_CONTROL)
  waitUntil(c, edgeCache().put(publicDataCacheRequest(requestUrl, version), cached))
}

export function cachePrivatePublicDataResponse(
  c: unknown,
  requestUrl: string,
  response: Response,
  version: string | null = null,
): void {
  const cached = new Response(response.clone().body, response)
  cached.headers.set(
    'Cache-Control',
    `public, max-age=0, s-maxage=${PRIVATE_PUBLIC_DATA_EDGE_TTL}, stale-while-revalidate=120`,
  )
  waitUntil(c, edgeCache().put(publicDataCacheRequest(requestUrl, version), cached))
}

export function cacheSiteConfigResponse(c: unknown, requestUrl: string, response: Response): void {
  const cached = response.clone()
  cached.headers.set(
    'Cache-Control',
    `public, max-age=${SITE_CONFIG_BROWSER_TTL}, s-maxage=${SITE_CONFIG_EDGE_TTL}, stale-while-revalidate=300`,
  )
  waitUntil(c, edgeCache().put(siteConfigCacheRequest(requestUrl), cached))
}

export function invalidatePublicDataCache(c: unknown, requestUrl: string): void {
  waitUntil(c, edgeCache().delete(publicDataCacheRequest(requestUrl)))
}

export function invalidateSiteConfigCache(c: unknown, requestUrl: string): void {
  waitUntil(c, edgeCache().delete(siteConfigCacheRequest(requestUrl)))
}
