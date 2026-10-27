import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { ErrCode } from '../../shared/types'
import { serverError } from '../../worker/lib/routeHelpers'
import { categoriesRoutes } from '../../worker/routes/categories'

afterEach(() => vi.restoreAllMocks())

describe('serverError', () => {
  it('logs the original error and returns a generic 1500 body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('d1 exploded: secret detail')
    const app = new Hono()
    app.get('/x', (c) => serverError(c as never, 'failed to do x', boom))

    const res = await app.request('/x')
    expect(res.status).toBe(200)
    const body = await res.json() as { code: number; msg: string }
    expect(body.code).toBe(ErrCode.SERVER_ERROR)
    expect(body.msg).toBe('failed to do x')
    expect(JSON.stringify(body)).not.toContain('secret detail')
    expect(log).toHaveBeenCalledWith('[api] failed to do x:', boom)
  })

  it('honours an explicit 500 status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    app.get('/x', (c) => serverError(c as never, 'nope', new Error('e'), 500))
    expect((await app.request('/x')).status).toBe(500)
  })

  it('is used by real route catch blocks so D1 failures reach the Workers log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('prepare failed')
    const env = { DB: { prepare: () => { throw failure }, batch: () => { throw failure } } }
    const res = await categoriesRoutes.request('/', {}, env as never)
    const body = await res.json() as { code: number }
    expect(body.code).toBe(ErrCode.SERVER_ERROR)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[api]'), failure)
  })
})
