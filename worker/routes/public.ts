import { Hono } from 'hono'
import {
  ErrCode,
  type ApiResponse,
  type DataVersionResp,
  type PublicData,
  type SiteConfig,
} from '../../shared/types'
import { toPublicSettings } from '../../shared/settings'
import {
  PUBLIC_DATA_CACHE_CONTROL,
  cachePrivatePublicDataResponse,
  cachePublicDataResponse,
  cacheSiteConfigResponse,
  matchPublicDataCache,
  matchSiteConfigCache,
  parsePublicDataVersion,
} from '../lib/cache'
import { getPublicDataSource, getSiteConfig, getSiteConfigWithDataVersion } from '../lib/db'
import { recordBookmarkClick } from '../lib/clickRateLimit'
import { shouldBypassRequestCache } from '../lib/requestCache'
import { fail } from '../lib/response'
import { ok } from '../lib/response'
import { extractBearerToken, validateSession } from '../middleware/auth'
import type { HonoEnv } from '../types'

function isSiteConfig(value: unknown): value is SiteConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SiteConfig>
  return typeof candidate.site_title === 'string' && typeof candidate.public_mode === 'boolean'
}

async function readCachedSiteConfig(requestUrl: string): Promise<SiteConfig | null> {
  const cached = await matchSiteConfigCache(requestUrl)
  if (!cached) return null

  try {
    const payload = await cached.clone().json<ApiResponse<SiteConfig>>()
    return isSiteConfig(payload.data) ? payload.data : null
  } catch {
    return null
  }
}

function cacheSiteConfigData(c: Parameters<typeof cacheSiteConfigResponse>[0], requestUrl: string, data: SiteConfig): void {
  const response = Response.json(ok(data), {
    headers: {
      'Cache-Control': 'public, max-age=15, s-maxage=60, stale-while-revalidate=300',
    },
  })
  cacheSiteConfigResponse(c, requestUrl, response)
}

function unauthorizedResponse() {
  return Response.json(fail(ErrCode.UNAUTHORIZED, 'unauthorized'), {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

export const publicRoutes = new Hono<HonoEnv>()

publicRoutes.get('/config', async (c) => {
  const bypassCache = shouldBypassRequestCache(c.req.header('Cache-Control'), c.req.header('Pragma'))
  if (!bypassCache) {
    const cached = await matchSiteConfigCache(c.req.url)
    if (cached) return cached
  }

  const data: SiteConfig = await getSiteConfig(c.env.DB)
  const response = c.json(ok(data), 200, {
    'Cache-Control': bypassCache ? 'no-store' : 'public, max-age=15, s-maxage=60, stale-while-revalidate=300',
  })
  if (!bypassCache) {
    cacheSiteConfigResponse(c, c.req.url, response)
  }
  return response
})

publicRoutes.get('/data/version', async (c) => {
  const token = extractBearerToken(c.req.header('Authorization'))
  // 每次页面加载都会走这里，所以站点配置和数据版本合并成一条 D1 查询。
  const { config: siteConfig, version, ...iconMetadata } = await getSiteConfigWithDataVersion(c.env.DB)
  const session = token ? await validateSession(c.env, token) : null
  if (token && !session) return unauthorizedResponse()

  if (!siteConfig.public_mode) {
    if (!token) {
      return c.json({
        ...fail(ErrCode.FORBIDDEN, 'forbidden'),
        data: {
          site_title: siteConfig.site_title,
          public_mode: false,
        },
      }, 200, {
        'Cache-Control': 'no-store',
      })
    }

    c.set('username', session!.username)
  }

  const data: DataVersionResp = {
    version,
    ...iconMetadata,
    site_title: siteConfig.site_title,
    public_mode: siteConfig.public_mode,
  }

  return c.json(ok(data), 200, {
    'Cache-Control': 'no-store',
  })
})

function forbiddenPublicDataResponse(config: SiteConfig): Response {
  return Response.json({
    ...fail(ErrCode.FORBIDDEN, 'forbidden'),
    data: {
      site_title: config.site_title,
      public_mode: false,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

function withNoStore(response: Response): Response {
  const copy = new Response(response.body, response)
  copy.headers.set('Cache-Control', 'no-store')
  return copy
}

publicRoutes.get('/public/data', async (c) => {
  const token = extractBearerToken(c.req.header('Authorization'))
  if (token) {
    // 带 token 的请求一律按会话判定且从不读写共享缓存：无效 token 不能退回匿名结果，
    // 有效会话（无论公开模式开关）额外返回私密书签。
    const session = await validateSession(c.env, token)
    if (!session) return unauthorizedResponse()
    c.set('username', session.username)
    c.set('sessionExpiresAt', session.exp)
    const source = await getPublicDataSource(c.env.DB, true)
    const data: PublicData = publicDataPayload(source)
    return c.json(ok(data), 200, { 'Cache-Control': 'no-store' })
  }

  // 匿名请求不理会客户端的 no-cache / Pragma：否则任何人都能用一个请求头强制读 D1，
  // edge cache 形同虚设。新鲜度改由 `?v=<data_version>` 保证：版本前进即换键。
  const requestedVersion = parsePublicDataVersion(c.req.url)
  const hit = await matchPublicDataCache(c.req.url, requestedVersion)
  if (hit) return hit

  let siteConfig: SiteConfig | null = null
  let requestedVersionIsCurrent = true
  if (requestedVersion) {
    // 带版本未命中：一次轻量 settings 查询确认版本是否仍是当前版本。过期或伪造的 v
    // 只付这一条小查询，随后复用当前版本的缓存副本（以 no-store 返回），不触发全量聚合读取。
    const meta = await getSiteConfigWithDataVersion(c.env.DB)
    siteConfig = meta.config
    cacheSiteConfigData(c, c.req.url, siteConfig)
    requestedVersionIsCurrent = meta.version === requestedVersion
    if (siteConfig.public_mode && !requestedVersionIsCurrent) {
      const current = await matchPublicDataCache(c.req.url, meta.version)
      if (current) return withNoStore(current)
    }
  } else {
    siteConfig = await readCachedSiteConfig(c.req.url)
    if (!siteConfig) {
      siteConfig = await getSiteConfig(c.env.DB)
      cacheSiteConfigData(c, c.req.url, siteConfig)
    }
  }

  // 私有站点的 1005 响应短时缓存在本次请求的键下；过期版本不缓存，避免占用无效键。
  const forbidden = (config: SiteConfig) => {
    const response = forbiddenPublicDataResponse(config)
    if (requestedVersionIsCurrent) cachePrivatePublicDataResponse(c, c.req.url, response, requestedVersion)
    return response
  }
  if (!siteConfig.public_mode) return forbidden(siteConfig)

  const source = await getPublicDataSource(c.env.DB, false)
  // 可见性与版本以同一 batch 为准；先前读到的配置可能已过期。
  if (!source.settings.public_mode) return forbidden(source.settings)

  const cacheable = requestedVersion === null || source.version === requestedVersion
  const response = c.json(ok<PublicData>(publicDataPayload(source)), 200, {
    'Cache-Control': cacheable ? PUBLIC_DATA_CACHE_CONTROL : 'no-store',
  })
  // 内容总是写进它真实版本的键（版本由同一 batch 读出），让随后带新版本的请求直接命中；
  // 无版本请求另外写旧客户端使用的无版本键。
  cachePublicDataResponse(c, c.req.url, response, source.version)
  if (requestedVersion === null) cachePublicDataResponse(c, c.req.url, response, null)
  return response
})

function publicDataPayload(source: Awaited<ReturnType<typeof getPublicDataSource>>): PublicData {
  return {
    categories: source.categories,
    bookmarks: source.bookmarks,
    settings: toPublicSettings(source.settings),
    version: source.version,
    ...(source.dataset_epoch ? { dataset_epoch: source.dataset_epoch } : {}),
    ...(source.icon_epoch !== undefined ? { icon_epoch: source.icon_epoch } : {}),
  }
}

import { getClientIp } from '../middleware/rateLimit'
import { serverError } from '../lib/routeHelpers'

publicRoutes.post('/public/bookmarks/:id/click', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(fail(ErrCode.BAD_REQUEST, 'invalid id'), 400)
  }

  // 限流（每 IP + 书签 10 分钟最多 3 次）与计数在同一个 D1 batch；超限仍返回成功但不计数。
  try {
    const outcome = await recordBookmarkClick(c.env.DB, id, getClientIp(c))
    if (outcome === 'not_found') {
      return c.json(fail(ErrCode.NOT_FOUND, 'bookmark not found'), 404)
    }
    // 点击计数不提升 data_version：每次点击都提升会让所有访客的公开数据缓存整体失效。
    // 后台「访问分析」在打开时强制拉取最新聚合数据，因此这里无需破坏缓存。
    return c.json(ok(null))
  } catch (error) {
    return serverError(c, 'failed to increment click count', error, 500)
  }
})

export default publicRoutes
