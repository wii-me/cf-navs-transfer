import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BlockedFetchTargetError,
  MAX_SAFE_REDIRECTS,
  fetchFollowingSafeRedirects,
  fetchPageHtml,
} from '../../worker/lib/pageMetadata'
import { fetchManifestJson } from '../../worker/lib/webManifest'
import faviconRoutes from '../../worker/routes/favicon'
import bookmarksRoutes from '../../worker/routes/bookmarks'
import type { Env } from '../../worker/types'

// 代码审查：页面元信息、manifest、favicon 探测与链接健康检查的出网 fetch
// 原先 redirect: 'follow'，公网地址可 302 到内网 / 元数据地址绕过入口检查。

type Call = { url: string; method: string; redirect?: RequestRedirect }

function stubRoutes(routes: Record<string, (method: string) => Response>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ url, method, redirect: init.redirect })
    const route = routes[url]
    if (!route) throw new Error('unexpected fetch ' + url)
    return route(method)
  }))
  return calls
}

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { Location: location } })
const html = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchFollowingSafeRedirects', () => {
  it('follows public hops manually and reports the final url', async () => {
    const calls = stubRoutes({
      'https://a.example/': redirect('/next', 301),
      'https://a.example/next': redirect('https://b.example/done', 308),
      'https://b.example/done': html('<p>ok</p>'),
    })
    const { response, finalUrl } = await fetchFollowingSafeRedirects('https://a.example/')
    expect(response.status).toBe(200)
    expect(finalUrl).toBe('https://b.example/done')
    expect(calls.every((call) => call.redirect === 'manual')).toBe(true)
  })

  it('rejects internal entry targets without any request', async () => {
    const calls = stubRoutes({})
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://localhost/', 'http://[::1]/', 'file:///etc/passwd']) {
      await expect(fetchFollowingSafeRedirects(url)).rejects.toBeInstanceOf(BlockedFetchTargetError)
    }
    expect(calls).toEqual([])
  })

  it('rejects a hop into an internal address and never requests it', async () => {
    const calls = stubRoutes({ 'https://a.example/': redirect('http://10.0.0.8/admin') })
    await expect(fetchFollowingSafeRedirects('https://a.example/')).rejects.toBeInstanceOf(BlockedFetchTargetError)
    expect(calls.map((call) => call.url)).toEqual(['https://a.example/'])
  })

  it('rejects unparsable or non-http locations', async () => {
    stubRoutes({ 'https://a.example/': redirect('javascript:alert(1)') })
    await expect(fetchFollowingSafeRedirects('https://a.example/')).rejects.toBeInstanceOf(BlockedFetchTargetError)
  })

  it('bounds the number of hops', async () => {
    const routes: Record<string, () => Response> = {}
    for (let hop = 0; hop <= MAX_SAFE_REDIRECTS + 1; hop++) routes[`https://a.example/${hop}`] = redirect(`/${hop + 1}`)
    const calls = stubRoutes(routes)
    await expect(fetchFollowingSafeRedirects('https://a.example/0')).rejects.toThrow('too many redirects')
    expect(calls).toHaveLength(MAX_SAFE_REDIRECTS + 1)
  })

  it('keeps HEAD across 303 and strips embedded credentials', async () => {
    const calls = stubRoutes({
      'https://a.example/x': redirect('/y', 303),
      'https://a.example/y': () => new Response(null, { status: 200 }),
    })
    await fetchFollowingSafeRedirects('https://user:pw@a.example/x', { method: 'HEAD' })
    expect(calls.map((call) => [call.url, call.method])).toEqual([['https://a.example/x', 'HEAD'], ['https://a.example/y', 'HEAD']])
  })

  it('treats a 3xx without Location as the final response', async () => {
    stubRoutes({ 'https://a.example/': () => new Response(null, { status: 304 }) })
    const { response } = await fetchFollowingSafeRedirects('https://a.example/')
    expect(response.status).toBe(304)
  })
})

describe('outbound callers use the guarded redirect path', () => {
  it('fetchPageHtml follows public redirects and uses the real final url', async () => {
    stubRoutes({
      'https://a.example/': redirect('https://www.a.example/home'),
      'https://www.a.example/home': html('<head><title>A</title></head>'),
    })
    const page = await fetchPageHtml('https://a.example/')
    expect(page?.finalUrl).toBe('https://www.a.example/home')
    expect(page?.html).toContain('<title>A</title>')
  })

  it('fetchPageHtml returns null instead of reading an internal redirect target', async () => {
    const calls = stubRoutes({ 'https://a.example/': redirect('http://169.254.169.254/latest/meta-data') })
    expect(await fetchPageHtml('https://a.example/')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('fetchManifestJson refuses an internal redirect hop', async () => {
    const calls = stubRoutes({ 'https://a.example/m.json': redirect('http://192.168.1.1/m.json') })
    expect(await fetchManifestJson('https://a.example/m.json')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('fetch-site-meta falls back to the hostname when the page redirects internally', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { default: { match: async () => undefined, put: async () => undefined, delete: async () => true } },
    })
    const calls = stubRoutes({ 'https://a.example/': redirect('http://127.0.0.1:8080/') })
    const response = await faviconRoutes.request('https://navs.example.test/fetch-site-meta?url=' + encodeURIComponent('https://a.example/'))
    const body = await response.json() as { data: { title: string; final_url: string } }
    expect(body.data).toEqual({ title: 'a.example', final_url: 'https://a.example/' })
    expect(calls.map((call) => call.url)).toEqual(['https://a.example/'])
  })

  it('fetch-favicon never probes an icon candidate that redirects internally', async () => {
    const calls = stubRoutes({
      'https://a.example/': html('<head><link rel="icon" href="/fav.png"></head>'),
      'https://a.example/fav.png': redirect('http://10.1.2.3/fav.png'),
      'https://a.example/favicon.ico': redirect('http://[fd00::1]/favicon.ico'),
    })
    const response = await faviconRoutes.request('https://navs.example.test/fetch-favicon?url=' + encodeURIComponent('https://a.example/'))
    const body = await response.json() as { data: { icon: string } }
    expect(body.data.icon).toBe('https://favicon.im/a.example?larger=true')
    expect(calls.some((call) => /10\.1\.2\.3|fd00/.test(call.url))).toBe(false)
  })

  it('check-health reports blocked targets and never follows an internal hop', async () => {
    const rows = [
      { id: 1, url: 'https://a.example/' },
      { id: 2, url: 'http://127.0.0.1/' },
      { id: 3, url: 'https://c.example/' },
    ]
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }),
    }
    const calls = stubRoutes({
      'https://a.example/': () => new Response(null, { status: 204 }),
      'https://c.example/': redirect('http://169.254.169.254/'),
    })
    const response = await bookmarksRoutes.request('https://navs.example.test/check-health', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    }, { DB: db } as unknown as Env)
    const body = await response.json() as { data: Array<{ id: number; status: number | string; ok: boolean }> }
    expect(body.data).toEqual([
      { id: 1, status: 204, ok: true },
      { id: 2, status: 'blocked', ok: false },
      { id: 3, status: 'blocked', ok: false },
    ])
    expect(calls.map((call) => call.url)).toEqual(['https://a.example/', 'https://c.example/'])
    expect(calls.every((call) => call.redirect === 'manual')).toBe(true)
  })
})
