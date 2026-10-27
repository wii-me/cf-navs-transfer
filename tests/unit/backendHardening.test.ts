import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../helpers/d1Sqlite'
import { iconFixture } from '../helpers/iconFixture'
import { MAX_ICON_REDIRECTS, fetchIcon } from '../../worker/lib/iconData'
import { hashPassword, verifyPassword } from '../../worker/lib/crypto'
import { listBookmarks, listBookmarksWithIconBlobs } from '../../worker/lib/db/bookmarks'
import { resetJwtSecretCache } from '../../worker/lib/jwt'
import { createSession } from '../../worker/lib/session'
import { clearAllCachedSessions, validateSession } from '../../worker/middleware/auth'
import authRoutes from '../../worker/routes/auth'
import dataRoutes from '../../worker/routes/data'
import type { Env } from '../../worker/types'

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
const open: ReturnType<typeof createSqliteD1>[] = []
afterEach(() => {
  for (const item of open.splice(0)) item.close()
  vi.unstubAllGlobals()
  clearAllCachedSessions()
  resetJwtSecretCache()
})

function database() {
  const instance = createSqliteD1(schema)
  open.push(instance)
  instance.sqlite.exec("INSERT INTO categories(id,title,sort,created_at) VALUES(1,'Root',0,1)")
  return instance
}

function setting(instance: ReturnType<typeof createSqliteD1>, key: string): unknown {
  const row = instance.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? JSON.parse(row.value) : undefined
}

describe('fetchIcon SSRF guard', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>'

  function stubRoutes(routes: Record<string, () => Response>) {
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, redirect: init.redirect })
      const route = routes[url]
      if (!route) throw new Error('unexpected fetch ' + url)
      return route()
    }))
    return calls
  }

  const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { Location: location } })
  const image = () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })

  it('refuses internal targets before any network request', async () => {
    const calls = stubRoutes({})
    for (const url of ['http://127.0.0.1/a.svg', 'http://169.254.169.254/latest', 'http://localhost/a.svg', 'http://[::1]/a.svg', 'ftp://example.com/a.svg']) {
      expect(await fetchIcon(url)).toEqual({ ok: false, failure: 'missing' })
    }
    expect(calls).toEqual([])
  })

  it('follows public redirects manually, resolving relative locations', async () => {
    const calls = stubRoutes({
      'https://icons.example.com/a.svg': redirect('/b.svg', 301),
      'https://icons.example.com/b.svg': redirect('https://cdn.example.net/c.svg', 307),
      'https://cdn.example.net/c.svg': image,
    })
    const outcome = await fetchIcon('https://icons.example.com/a.svg')
    expect(outcome.ok).toBe(true)
    expect(calls.map((call) => call.url)).toEqual([
      'https://icons.example.com/a.svg', 'https://icons.example.com/b.svg', 'https://cdn.example.net/c.svg',
    ])
    expect(calls.every((call) => call.redirect === 'manual')).toBe(true)
  })

  it('blocks a redirect hop into a private or metadata address', async () => {
    const calls = stubRoutes({
      'https://icons.example.com/a.svg': redirect('http://169.254.169.254/latest/meta-data'),
    })
    expect(await fetchIcon('https://icons.example.com/a.svg')).toEqual({ ok: false, failure: 'missing' })
    expect(calls).toHaveLength(1)

    stubRoutes({ 'https://icons.example.com/a.svg': redirect('http://10.0.0.5/icon.png') })
    expect(await fetchIcon('https://icons.example.com/a.svg')).toEqual({ ok: false, failure: 'missing' })
  })

  it('bounds the number of hops', async () => {
    const routes: Record<string, () => Response> = {}
    for (let hop = 0; hop <= MAX_ICON_REDIRECTS + 1; hop++) routes[`https://icons.example.com/${hop}`] = redirect(`/${hop + 1}`)
    const calls = stubRoutes(routes)
    expect(await fetchIcon('https://icons.example.com/0')).toEqual({ ok: false, failure: 'missing' })
    expect(calls).toHaveLength(MAX_ICON_REDIRECTS + 1)
  })

  it('strips embedded credentials from the request target', async () => {
    const calls = stubRoutes({ 'https://icons.example.com/a.svg': image })
    expect((await fetchIcon('https://user:secret@icons.example.com/a.svg')).ok).toBe(true)
    expect(calls[0].url).toBe('https://icons.example.com/a.svg')
  })
})

describe('bookmark list icon bodies', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { default: { delete: async () => true, match: async () => undefined, put: async () => undefined } },
    })
  })

  it('lists bookmarks without reading icon bodies, keeping the icon_cached hint', async () => {
    const instance = database()
    instance.sqlite.prepare("INSERT INTO bookmarks(id,category_id,title,url,icon_blob,sort,created_at) VALUES(1,1,'A','https://a.example',?,0,1)").run(iconFixture().dataUri)
    instance.sqlite.exec("INSERT INTO bookmarks(id,category_id,title,url,sort,created_at) VALUES(2,1,'B','https://b.example',1,1)")
    const light = await listBookmarks(instance.db)
    expect(light.map((bookmark) => [bookmark.id, bookmark.icon_blob, (bookmark as { icon_cached?: number }).icon_cached])).toEqual([[1, null, 1], [2, null, 0]])
    const full = await listBookmarksWithIconBlobs(instance.db)
    expect(full[0].icon_blob).toBe(iconFixture().dataUri)
  })

  it('preserves cached icon bodies through a merge import that rebuilds the table', async () => {
    const instance = database()
    instance.sqlite.prepare("INSERT INTO bookmarks(id,category_id,title,url,icon_blob,sort,created_at) VALUES(1,1,'A','https://a.example',?,0,1)").run(iconFixture().dataUri)
    const response = await dataRoutes.request('https://navs.example.test/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'merge', categories: [{ id: 9, parent_id: null, title: 'New', icon: null, sort: 0, created_at: 1 }], bookmarks: [] }),
    }, { DB: instance.db } as Env)
    const body = await response.json() as { code: number; data_version?: string }
    expect(body.code).toBe(0)
    expect(body.data_version).toBeTruthy()
    const blobs = instance.sqlite.prepare('SELECT icon_blob FROM bookmarks').all() as Array<{ icon_blob: string | null }>
    expect(blobs).toEqual([{ icon_blob: iconFixture().dataUri }])
  })
})

describe('password change atomicity', () => {
  async function fixture() {
    const instance = database()
    instance.sqlite.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('admin_username', ?), ('admin_password', ?)")
      .run(JSON.stringify('admin'), JSON.stringify(await hashPassword('old-password-1')))
    const kv = new Map<string, string>()
    const env = {
      DB: instance.db,
      SESSION: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => { kv.set(key, value) }, delete: async (key: string) => { kv.delete(key) } },
      SESSION_TTL: '3600',
    } as unknown as Env
    const session = await createSession(env, 'admin')
    const change = (target: Env = env) => authRoutes.request('https://navs.example.test/password', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ current_password: 'old-password-1', new_password: 'new-password-2' }),
    }, target)
    return { instance, env, session, change }
  }

  it('writes the new password and the rotated secret together and revokes old sessions', async () => {
    const { instance, env, session, change } = await fixture()
    const secretBefore = setting(instance, 'jwt_secret')
    instance.statements.length = 0
    const response = await change()
    expect(await response.json()).toMatchObject({ code: 0 })
    expect(await verifyPassword('new-password-2', setting(instance, 'admin_password') as string)).toBe(true)
    expect(setting(instance, 'jwt_secret')).not.toBe(secretBefore)
    // One upsert statement carried both keys (prepare + bind are both recorded by the helper).
    expect(instance.statements.filter((sql) => sql.startsWith('INSERT INTO settings'))).toHaveLength(2)
    clearAllCachedSessions()
    expect(await validateSession(env, session.token)).toBeNull()
  })

  it('changes neither the password nor the secret when the combined write fails', async () => {
    const { instance, env, change } = await fixture()
    const passwordBefore = setting(instance, 'admin_password')
    const secretBefore = setting(instance, 'jwt_secret')
    const failing = {
      ...env,
      DB: {
        ...instance.db,
        batch: instance.db.batch,
        prepare: (sql: string) => {
          if (sql.startsWith('INSERT INTO settings') && sql.includes('ON CONFLICT')) throw new Error('D1 write failed')
          return instance.db.prepare(sql)
        },
      },
    } as unknown as Env
    const response = await change(failing)
    expect(await response.json()).toMatchObject({ msg: 'failed to update password' })
    expect(setting(instance, 'admin_password')).toBe(passwordBefore)
    expect(setting(instance, 'jwt_secret')).toBe(secretBefore)
  })
})
