import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const origin = 'https://example.test'
function redirectedShell(body = '<!doctype html>cached shell'): Response {
  const response = new Response(body, { headers: { 'content-type': 'text/html', 'x-shell': 'preserved' } })
  Object.defineProperty(response, 'redirected', { value: true })
  // A real Cache.match()/Response.clone() preserves the internal redirected flag.
  response.clone = () => redirectedShell(body)
  return response
}

function requestPath(request: Request | string): string {
  return new URL(typeof request === 'string' ? request : request.url, origin).pathname
}

async function navigate(path: string, entries: Map<string, Response>, offline = false, networkBody = '<!doctype html>network shell') {
  let handleFetch!: (event: unknown) => void
  const waits: Promise<unknown>[] = []
  const cache = {
    match: async (request: Request | string) => entries.get(requestPath(request))?.clone(),
    put: vi.fn(async (request: Request | string, response: Response) => {
      entries.set(requestPath(request), response.clone())
    }),
  }
  const fetch = vi.fn(async (_request: Request) => {
    if (offline) throw new Error('offline')
    return redirectedShell(networkBody)
  })
  const context = createContext({
    self: {
      addEventListener: (name: string, handler: typeof handleFetch) => { if (name === 'fetch') handleFetch = handler },
      location: new URL(origin + '/sw.js'),
      clients: { matchAll: async () => [] },
    },
    caches: { open: async () => cache, match: async (request: Request | string) => cache.match(request) },
    fetch, Request, Response, Headers, URL, Promise, Number, Date, console,
  })
  runInContext(readFileSync('public/sw.js', 'utf8'), context)
  const request = new Request(origin + path, { redirect: 'manual' })
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  let result!: Promise<Response>
  handleFetch({
    request,
    respondWith: (response: Response | Promise<Response>) => { result = Promise.resolve(response) },
    waitUntil: (promise: Promise<unknown>) => { waits.push(promise) },
  })
  const response = await result
  await Promise.all(waits)
  return { response, fetch, cache }
}

describe('service worker navigation response compatibility', () => {
  it.each(['/', '/admin', '/index.html'])('serves redirected cached HTML safely for %s', async (path) => {
    const cachePath = path === '/' || path === '/index.html' ? '/index.html' : path
    const { response } = await navigate(path, new Map([[cachePath, redirectedShell()]]))
    expect(response.redirected).toBe(false)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-shell')).toBe('preserved')
    expect(await response.text()).toBe('<!doctype html>cached shell')
  })

  it('normalizes a cold navigation without losing network content', async () => {
    const { response } = await navigate('/', new Map())
    expect(response.redirected).toBe(false)
    expect(await response.text()).toBe('<!doctype html>network shell')
  })

  it('keeps cached HTML available offline even if installation followed a redirect', async () => {
    const { response } = await navigate('/', new Map([['/index.html', redirectedShell()]]), true)
    expect(response.redirected).toBe(false)
    expect(await response.text()).toBe('<!doctype html>cached shell')
  })

  it('keeps the standalone guide separate from the app shell cache entry', async () => {
    const entries = new Map([['/index.html', redirectedShell('<!doctype html>cached shell')]])
    const { response, cache } = await navigate('/guide/', entries, false, '<!doctype html>guide page')

    expect(response.redirected).toBe(false)
    expect(await response.text()).toBe('<!doctype html>guide page')
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce())
    expect(requestPath(cache.put.mock.calls[0][0])).toBe('/guide/')
    expect(await entries.get('/index.html')?.text()).toBe('<!doctype html>cached shell')

    const offlineGuide = await navigate('/guide/', entries, true)
    expect(await offlineGuide.response.text()).toBe('<!doctype html>guide page')
    const offlineHome = await navigate('/', entries, true)
    expect(await offlineHome.response.text()).toBe('<!doctype html>cached shell')
  })
})
