import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import { parsePublicDataVersion } from '../../worker/lib/cache'
import { cacheValidatedSession, clearAllCachedSessions } from '../../worker/middleware/auth'
import publicRoutes from '../../worker/routes/public'
import type { Env } from '../../worker/types'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const token = 'synthetic-session-not-a-production-token'
const origin = 'https://navs.example.test'

let store: Map<string, Response>
let pending: Promise<unknown>[]
let instance: ReturnType<typeof createSqliteD1>

beforeEach(() => {
  store = new Map()
  pending = []
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        async match(request: Request) {
          return store.get(request.url)?.clone()
        },
        async put(request: Request, response: Response) {
          store.set(request.url, response.clone())
        },
        async delete(request: Request) {
          return store.delete(request.url)
        },
      },
    },
  })
  instance = createSqliteD1(schema)
  instance.sqlite.exec("INSERT INTO categories(id,title,sort,created_at) VALUES(1,'Root',0,1)")
  instance.sqlite.exec("INSERT INTO bookmarks(id,category_id,title,url,sort,created_at) VALUES(1,1,'A','https://a.example',0,1)")
  setVersion('v1')
})

afterEach(() => {
  instance.close()
  clearAllCachedSessions()
})

function setVersion(version: string) {
  instance.sqlite.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('data_version',?)").run(JSON.stringify(version))
}

function setPublicMode(value: boolean) {
  instance.sqlite.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('public_mode',?)").run(JSON.stringify(value))
}

async function get(path: string, headers: Record<string, string> = {}) {
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: vi.fn(), props: {} }
  const env = { DB: instance.db } as Env
  const response = await publicRoutes.request(origin + path, { headers }, env, ctx as never)
  await Promise.all(pending.splice(0))
  return response
}

/** Statements prepared against D1 since the last call (the helper records prepare + bind). */
function takeStatements(): string[] {
  return instance.statements.splice(0)
}

describe('anonymous /api/public/data edge cache', () => {
  it('ignores anonymous no-cache directives so a header cannot force D1 reads', async () => {
    const first = await get('/public/data', { 'cache-control': 'no-cache', pragma: 'no-cache' })
    expect((await first.json() as any).data.version).toBe('v1')
    expect(first.headers.get('Cache-Control')).toContain('public')
    takeStatements()

    const second = await get('/public/data', { 'cache-control': 'no-cache, max-age=0', pragma: 'no-cache' })
    expect((await second.json() as any).data.version).toBe('v1')
    expect(takeStatements()).toEqual([])
  })

  it('keys versioned requests by v and serves later hits without D1', async () => {
    const first = await get('/public/data?v=v1')
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=')
    expect([...store.keys()]).toContain(`${origin}/api/public/data?v=v1`)
    takeStatements()

    const hit = await get('/public/data?v=v1&cachebust=1')
    expect((await hit.json() as any).data.version).toBe('v1')
    expect(takeStatements()).toEqual([])
  })

  it('answers a stale v from the current version cache as no-store with one light query', async () => {
    await get('/public/data?v=v1')
    setVersion('v2')
    await get('/public/data?v=v2')
    takeStatements()

    const stale = await get('/public/data?v=v1-stale')
    expect(stale.headers.get('Cache-Control')).toBe('no-store')
    expect((await stale.json() as any).data.version).toBe('v2')
    const statements = takeStatements()
    expect(statements.some((sql) => sql.includes("'data_version'") && sql.startsWith('SELECT key, value FROM settings'))).toBe(true)
    expect(statements.some((sql) => sql.includes('FROM bookmarks'))).toBe(false)
    expect(store.has(`${origin}/api/public/data?v=v1-stale`)).toBe(false)
  })

  it('never caches content under a version it was not read at', async () => {
    const stale = await get('/public/data?v=old')
    expect(stale.headers.get('Cache-Control')).toBe('no-store')
    expect((await stale.json() as any).data.version).toBe('v1')
    expect(store.has(`${origin}/api/public/data?v=old`)).toBe(false)
    // The fresh read populated its real version, so the next correct request is a hit.
    expect(store.has(`${origin}/api/public/data?v=v1`)).toBe(true)
  })

  it('populates both the legacy unversioned key and the version key from an unversioned miss', async () => {
    await get('/public/data')
    expect(store.has(`${origin}/api/public/data`)).toBe(true)
    expect(store.has(`${origin}/api/public/data?v=v1`)).toBe(true)
  })

  it('treats a malformed v as unversioned', async () => {
    expect(parsePublicDataVersion(`${origin}/api/public/data?v=${'x'.repeat(65)}`)).toBeNull()
    expect(parsePublicDataVersion(`${origin}/api/public/data?v=a%20b`)).toBeNull()
    expect(parsePublicDataVersion(`${origin}/api/public/data?v=abc-123_Z`)).toBe('abc-123_Z')
    await get('/public/data?v=bad%20value')
    expect(store.has(`${origin}/api/public/data`)).toBe(true)
    expect([...store.keys()].some((key) => key.includes('bad'))).toBe(false)
  })

  it('returns the private-site 1005 envelope without leaking data', async () => {
    setPublicMode(false)
    const response = await get('/public/data?v=v1')
    const body = await response.json() as any
    expect(body.code).toBe(1005)
    expect(body.data).toEqual({ site_title: 'CF-Navs', public_mode: false })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('authenticated /api/public/data', () => {
  it('never reads or writes the shared cache and rejects invalid tokens', async () => {
    await get('/public/data')
    cacheValidatedSession(token, { username: 'fixture-admin', exp: Date.now() + 60000 })
    instance.sqlite.exec("INSERT INTO bookmarks(id,category_id,title,url,is_private,sort,created_at) VALUES(2,1,'Secret','https://s.example',1,1,1)")
    const keys = [...store.keys()]

    const authed = await get('/public/data', { authorization: 'Bearer ' + token })
    const body = await authed.json() as any
    expect(authed.headers.get('Cache-Control')).toBe('no-store')
    expect(body.data.bookmarks.map((bookmark: any) => bookmark.id).sort()).toEqual([1, 2])
    expect(body.data.auth_receipt).toBeUndefined()
    expect([...store.keys()]).toEqual(keys)

    const invalid = await get('/public/data?v=v1', { authorization: 'Bearer invalid-fixture-token' })
    expect(invalid.status).toBe(401)
  })

  it('serves private-mode data to a valid session', async () => {
    setPublicMode(false)
    cacheValidatedSession(token, { username: 'fixture-admin', exp: Date.now() + 60000 })
    const authed = await get('/public/data', { authorization: 'Bearer ' + token })
    expect((await authed.json() as any).code).toBe(0)
  })
})
