import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { transfersRoutes } from '../../worker/routes/transfers'
import type { HonoEnv } from '../../worker/types'
import type { TransferNote } from '../../shared/types'

describe('Transfer Routes', () => {
  let notes: TransferNote[] = []
  let storageObjects: Map<string, { body: Uint8Array; contentType: string }> = new Map()

  const createMockDb = () => {
    return {
      prepare: (sql: string) => {
        let boundParams: unknown[] = []
        const execute = () => ({
          all: async <T>() => {
            if (sql.includes('expires_at IS NOT NULL AND expires_at <')) {
              const now = Number(boundParams[0])
              const expired = notes.filter((n) => n.expires_at !== null && n.expires_at < now)
              return { results: expired as T[] }
            }
            if (sql.includes('SELECT file_key FROM transfer_notes WHERE file_key IS NOT NULL')) {
              const keys = notes.map((n) => ({ file_key: n.file_key })).filter((k) => k.file_key !== null)
              return { results: keys as T[] }
            }
            if (sql.includes('SELECT * FROM transfer_notes')) {
              let filtered = [...notes]
              if (sql.includes('WHERE created_at < ?')) {
                const cursor = Number(boundParams[0])
                filtered = filtered.filter((n) => n.created_at < cursor)
              }
              filtered.sort((a, b) => b.created_at - a.created_at)
              const limitParam = sql.includes('WHERE created_at < ?') ? boundParams[1] : boundParams[0]
              const limit = Number(limitParam ?? 50)
              return { results: filtered.slice(0, limit) as T[] }
            }
            return { results: [] as T[] }
          },
          first: async <T>() => {
            if (sql.includes('WHERE id = ?')) {
              const id = String(boundParams[0])
              const found = notes.find((n) => n.id === id)
              return (found ?? null) as T
            }
            return null
          },
          run: async () => {
            if (sql.includes('DELETE FROM transfer_notes WHERE expires_at IS NOT NULL')) {
              const now = Number(boundParams[0])
              notes = notes.filter((n) => n.expires_at === null || n.expires_at >= now)
              return { success: true }
            }
            if (sql.includes('DELETE FROM transfer_notes WHERE id = ?')) {
              const id = String(boundParams[0])
              notes = notes.filter((n) => n.id !== id)
              return { success: true }
            }
            if (sql.includes('DELETE FROM transfer_notes')) {
              const count = notes.length
              notes = []
              return { success: true, meta: { changes: count } }
            }
            if (sql.includes('INSERT INTO transfer_notes')) {
              const [id, type, content, file_key, file_name, file_size, mime_type, created_at, expires_at] = boundParams
              const newNote: TransferNote = {
                id: String(id),
                type: type as any,
                content: (content as string) ?? null,
                file_key: (file_key as string) ?? null,
                file_name: (file_name as string) ?? null,
                file_size: (file_size as number) ?? null,
                mime_type: (mime_type as string) ?? null,
                created_at: Number(created_at),
                expires_at: expires_at != null ? Number(expires_at) : null,
              }
              notes.push(newNote)
              return { success: true }
            }
            return { success: true }
          },
        })

        return {
          bind: (...params: unknown[]) => {
            boundParams = params
            return execute()
          },
          all: () => execute().all(),
          first: () => execute().first(),
          run: () => execute().run(),
        }
      },
    }
  }

  const createMockStorage = () => {
    return {
      put: async (key: string, body: ReadableStream | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => {
        storageObjects.set(key, {
          body: new Uint8Array([1, 2, 3]),
          contentType: options?.httpMetadata?.contentType || 'application/octet-stream',
        })
        return {} as any
      },
      get: async (key: string) => {
        const item = storageObjects.get(key)
        if (!item) return null
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(item.body)
              controller.close()
            },
          }),
          httpMetadata: { contentType: item.contentType },
        } as any
      },
      delete: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) {
          storageObjects.delete(k)
        }
      },
    }
  }

  let app: Hono<HonoEnv>

  beforeEach(() => {
    notes = []
    storageObjects.clear()

    app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockDb() as any,
        STORAGE: createMockStorage() as any,
      } as any
      await next()
    })
    app.route('/api/transfers', transfersRoutes)
  })

  it('creates text note with POST /api/transfers/text', async () => {
    const res = await app.request('/api/transfers/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello World', ttlDays: 7 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.code).toBe(0)
    expect(body.data.content).toBe('Hello World')
    expect(body.data.type).toBe('text')
    expect(body.data.expires_at).toBeGreaterThan(Date.now())
    expect(notes).toHaveLength(1)
  })

  it('rejects empty text with 400', async () => {
    const res = await app.request('/api/transfers/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.code).not.toBe(0)
    expect(notes).toHaveLength(0)
  })

  it('lists notes and purges expired with GET /api/transfers', async () => {
    notes.push({
      id: 'old_1',
      type: 'text',
      content: 'Expired text',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: 1000,
      expires_at: 2000, // already expired
    })
    notes.push({
      id: 'valid_1',
      type: 'text',
      content: 'Active text',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: Date.now(),
      expires_at: Date.now() + 100000,
    })

    const res = await app.request('/api/transfers')
    expect(res.status).toBe(200)
    const body = await res.json<any>()
    expect(body.code).toBe(0)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].id).toBe('valid_1')
    expect(notes).toHaveLength(1)
  })

  it('uploads file with POST /api/transfers/file and downloads with GET /api/transfers/file/:id', async () => {
    const formData = new FormData()
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' })
    formData.append('file', file)
    formData.append('ttlDays', '1')

    const uploadRes = await app.request('/api/transfers/file', {
      method: 'POST',
      body: formData,
    })

    expect(uploadRes.status).toBe(200)
    const uploadBody = await uploadRes.json<any>()
    expect(uploadBody.code).toBe(0)
    expect(uploadBody.data.type).toBe('image')
    expect(uploadBody.data.file_name).toBe('photo.png')
    expect(storageObjects.size).toBe(1)

    const noteId = uploadBody.data.id
    const downloadRes = await app.request(`/api/transfers/file/${noteId}`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('Content-Type')).toBe('image/png')
    expect(downloadRes.headers.get('Content-Disposition')).toContain('inline')

    const forceDownloadRes = await app.request(`/api/transfers/file/${noteId}?download=1`)
    expect(forceDownloadRes.status).toBe(200)
    expect(forceDownloadRes.headers.get('Content-Disposition')).toContain('attachment')
    expect(forceDownloadRes.headers.get('Content-Disposition')).toContain("filename*=UTF-8''photo.png")
  })

  it('deletes note with DELETE /api/transfers/:id', async () => {
    notes.push({
      id: 'del_1',
      type: 'text',
      content: 'to delete',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: Date.now(),
      expires_at: null,
    })

    const res = await app.request('/api/transfers/del_1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(notes).toHaveLength(0)
  })

  it('clears all with POST /api/transfers/clear', async () => {
    notes.push({
      id: 'c1',
      type: 'text',
      content: 'msg 1',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: Date.now(),
      expires_at: null,
    })
    notes.push({
      id: 'c2',
      type: 'file',
      content: null,
      file_key: 'transfers/f2.pdf',
      file_name: 'f2.pdf',
      file_size: 10,
      mime_type: 'application/pdf',
      created_at: Date.now(),
      expires_at: null,
    })
    storageObjects.set('transfers/f2.pdf', { body: new Uint8Array([1]), contentType: 'application/pdf' })

    const res = await app.request('/api/transfers/clear', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(notes).toHaveLength(0)
    expect(storageObjects.size).toBe(0)
  })
})
