import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../schema.sql', () => ({ default: 'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);' }))

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { ErrCode } from '../../shared/types'
import { badRequest, serverError, type AppContext } from '../../worker/lib/routeHelpers'
import { authRequired } from '../../worker/middleware/auth'
import app from '../../worker/index'
import type { Env, HonoEnv } from '../../worker/types'
import { ApiError, request, setApiBaseUrl } from '../../src/lib/api'

// 代码审查三轮第 5 项：错误码约定。约定正文见 docs/reference/API_CONTRACT.md「错误码与 HTTP 状态约定」。
// 这里把 helper → HTTP 状态 → code 的映射钉死，并对 worker 中所有「显式非 200」的失败响应做快照，
// 新增真实 HTTP 状态的失败分支必须同时改这里和契约表。

type Envelope = { code: number; msg: string; data: unknown }

async function call(handler: (c: AppContext) => Response | Promise<Response>) {
  const local = new Hono<HonoEnv>()
  local.get('/x', handler)
  const res = await local.request('/x')
  return { status: res.status, body: await res.json() as Envelope }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setApiBaseUrl('/api')
})

describe('route helper status/code mapping', () => {
  it('badRequest → HTTP 200 + code=1002 (envelope-only business error)', async () => {
    const { status, body } = await call((c) => badRequest(c, 'invalid thing'))
    expect(status).toBe(200)
    expect(body).toEqual({ code: ErrCode.BAD_REQUEST, msg: 'invalid thing', data: null })
    expect(ErrCode.BAD_REQUEST).toBe(1002)
  })

  it('serverError → HTTP 200 + code=1500 by default, real 500 only when asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fallback = await call((c) => serverError(c, 'boom', new Error('e')))
    expect(fallback.status).toBe(200)
    expect(fallback.body).toEqual({ code: ErrCode.SERVER_ERROR, msg: 'boom', data: null })
    const explicit = await call((c) => serverError(c, 'boom', new Error('e'), 500))
    expect(explicit.status).toBe(500)
    expect(explicit.body.code).toBe(1500)
  })

  it('authRequired → real HTTP 401 + code=1001', async () => {
    const local = new Hono<HonoEnv>()
    local.use('*', authRequired)
    local.get('/x', (c) => c.json({ code: 0, msg: 'ok', data: null }))
    const res = await local.request('/x', {}, {} as Env)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ code: ErrCode.UNAUTHORIZED, msg: 'unauthorized', data: null })
  })

  it('pins the numeric error codes the frontend and extension compare against', () => {
    expect(ErrCode).toEqual({
      OK: 0,
      UNAUTHORIZED: 1001,
      BAD_REQUEST: 1002,
      NOT_FOUND: 1003,
      RATE_LIMITED: 1004,
      FORBIDDEN: 1005,
      CONFLICT: 1006,
      SERVER_ERROR: 1500,
    })
  })

  it('global onError on /api/* → HTTP 200 + code=1500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 公开路由 /config 读 D1；env 里没有 DB 会抛错并落到全局 onError。
    const res = await app.request('https://navs.example.test/api/config', {}, {} as Env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: ErrCode.SERVER_ERROR, msg: 'internal server error', data: null })
  })
})

// worker 里所有写成 `c.json(fail(ErrCode.X, ...), <status>)` 的非 200 失败分支。
// 这些是约定中「真实 HTTP 状态」的例外端点，逐条见 API_CONTRACT 的约定表。
const EXPECTED_NON_200_FAILURES = [
  'middleware/auth.ts UNAUTHORIZED 401',
  'middleware/auth.ts UNAUTHORIZED 401',
  'routes/auth.ts UNAUTHORIZED 401',
  'routes/errorReport.ts BAD_REQUEST 413',
  'routes/errorReport.ts BAD_REQUEST 413',
  'routes/errorReport.ts BAD_REQUEST 400',
  'routes/errorReport.ts BAD_REQUEST 400',
  'routes/errorReport.ts RATE_LIMITED 429',
  'routes/icon.ts BAD_REQUEST 400',
  'routes/icon.ts SERVER_ERROR 502',
  'routes/install.ts FORBIDDEN 403',
  'routes/install.ts UNAUTHORIZED 401',
  'routes/public.ts BAD_REQUEST 400',
  'routes/public.ts NOT_FOUND 404',
  'routes/recover.ts FORBIDDEN 403',
  'routes/recover.ts UNAUTHORIZED 401',
]

function workerFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) return workerFiles(join(dir, entry.name), rel)
    return entry.name.endsWith('.ts') ? [rel] : []
  })
}

describe('non-200 failure responses stay on the documented allowlist', () => {
  it('matches the snapshot of explicit-status fail() responses in worker/', () => {
    const root = join(process.cwd(), 'worker')
    const found: string[] = []
    for (const file of workerFiles(root).sort()) {
      const source = readFileSync(join(root, file), 'utf8')
      for (const match of source.matchAll(/fail\(ErrCode\.([A-Z_]+),[^\n]*?\),\s*(\d{3})\)/g)) {
        found.push(`${file} ${match[1]} ${match[2]}`)
      }
    }
    expect(found).toEqual(EXPECTED_NON_200_FAILURES)
  })

  it('every explicit status is a 4xx/5xx and every code is an ErrCode key', () => {
    for (const entry of EXPECTED_NON_200_FAILURES) {
      const [, code, status] = entry.split(' ')
      expect(code in ErrCode).toBe(true)
      expect(Number(status)).toBeGreaterThanOrEqual(400)
    }
  })
})

describe('frontend api client treats both error shapes as ApiError', () => {
  function stubResponse(status: number, body: Envelope) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })))
  }

  it('HTTP 200 + non-zero code → ApiError(status=200, code=envelope.code)', async () => {
    stubResponse(200, { code: ErrCode.BAD_REQUEST, msg: 'invalid url', data: null })
    const error = await request('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, code: ErrCode.BAD_REQUEST, message: 'invalid url' })
  })

  it('real HTTP 4xx with envelope → ApiError(status=HTTP, code=envelope.code)', async () => {
    stubResponse(404, { code: ErrCode.NOT_FOUND, msg: 'bookmark not found', data: null })
    const error = await request('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: ErrCode.NOT_FOUND, message: 'bookmark not found' })
  })
})
