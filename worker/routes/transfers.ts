import { Hono } from 'hono'
import {
  ErrCode,
  type TransferClearResp,
  type TransferNote,
  type TransferNotesResp,
  type TransferTextReq,
} from '../../shared/types'
import { fail, ok } from '../lib/response'
import { badRequest, readJson, type AppContext } from '../lib/routeHelpers'
import type { HonoEnv } from '../types'

export const transfersRoutes = new Hono<HonoEnv>()

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_TEXT_LENGTH = 100_000

// 异步惰性清理已过期记录和 R2 文件
async function purgeExpiredTransfers(c: AppContext): Promise<void> {
  try {
    const now = Date.now()
    const expired = await c.env.DB.prepare(
      'SELECT id, file_key FROM transfer_notes WHERE expires_at IS NOT NULL AND expires_at < ?'
    )
      .bind(now)
      .all<TransferNote>()

    const results = expired?.results ?? []
    if (results.length > 0) {
      if (c.env.STORAGE) {
        const keys = results
          .map((r: TransferNote) => r.file_key)
          .filter((k: unknown): k is string => typeof k === 'string' && k.length > 0)
        if (keys.length > 0) {
          try {
            await c.env.STORAGE.delete(keys)
          } catch (storageErr) {
            console.error('Failed to delete expired R2 objects:', storageErr)
          }
        }
      }

      await c.env.DB.prepare(
        'DELETE FROM transfer_notes WHERE expires_at IS NOT NULL AND expires_at < ?'
      )
        .bind(now)
        .run()
    }
  } catch (err) {
    console.error('Lazy transfer purge error:', err)
  }
}

// GET /api/transfers - 列表查询
transfersRoutes.get('/', async (c) => {
  try {
    let hasCtx = false
    try {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        hasCtx = true
      }
    } catch {
      hasCtx = false
    }

    if (hasCtx) {
      c.executionCtx.waitUntil(purgeExpiredTransfers(c))
    } else {
      await purgeExpiredTransfers(c)
    }

    const url = new URL(c.req.url)
    const limitParam = Number(url.searchParams.get('limit'))
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50
    const cursorParam = url.searchParams.get('cursor')
    const cursor = cursorParam ? Number(cursorParam) : null

    const query = cursor
      ? c.env.DB.prepare(
          'SELECT * FROM transfer_notes WHERE created_at < ? ORDER BY created_at DESC LIMIT ?'
        ).bind(cursor, limit + 1)
      : c.env.DB.prepare(
          'SELECT * FROM transfer_notes ORDER BY created_at DESC LIMIT ?'
        ).bind(limit + 1)

    const result = await query.all<TransferNote>()
    const all = result?.results ?? []
    const hasMore = all.length > limit
    const items = hasMore ? all.slice(0, limit) : all

    const resp: TransferNotesResp = { items, hasMore }
    return c.json(ok(resp))
  } catch (err) {
    console.error(err)
    return c.json(fail(ErrCode.SERVER_ERROR, 'failed to list transfers'))
  }
})

// POST /api/transfers/text - 发送纯文本
transfersRoutes.post('/text', async (c) => {
  const body = await readJson<TransferTextReq>(c)
  if (!body || typeof body.content !== 'string' || body.content.trim().length === 0) {
    return badRequest(c, 'content is required')
  }

  if (body.content.length > MAX_TEXT_LENGTH) {
    return badRequest(c, 'content is too long')
  }

  try {
    const now = Date.now()
    const ttlDays = typeof body.ttlDays === 'number' && body.ttlDays > 0 ? body.ttlDays : null
    const expiresAt = ttlDays ? now + ttlDays * 86_400_000 : null
    const id = `tn_${crypto.randomUUID()}`

    const note: TransferNote = {
      id,
      type: 'text',
      content: body.content,
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: now,
      expires_at: expiresAt,
    }

    await c.env.DB.prepare(
      'INSERT INTO transfer_notes (id, type, content, file_key, file_name, file_size, mime_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        note.id,
        note.type,
        note.content,
        note.file_key,
        note.file_name,
        note.file_size,
        note.mime_type,
        note.created_at,
        note.expires_at
      )
      .run()

    return c.json(ok(note))
  } catch (err) {
    console.error(err)
    return c.json(fail(ErrCode.SERVER_ERROR, 'failed to save text note'))
  }
})

// POST /api/transfers/file - 上传图片或小文件
transfersRoutes.post('/file', async (c) => {
  if (!c.env.STORAGE) {
    return c.json(fail(ErrCode.SERVER_ERROR, 'R2 storage is not configured'))
  }

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return badRequest(c, 'invalid form data')
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }

  if (file.size > MAX_FILE_SIZE) {
    return badRequest(c, 'file size exceeds 50MB limit')
  }

  const ttlDaysParam = formData.get('ttlDays')
  const ttlDays = ttlDaysParam ? Number(ttlDaysParam) : null
  const now = Date.now()
  const expiresAt = ttlDays && ttlDays > 0 ? now + ttlDays * 86_400_000 : null
  const id = `tn_${crypto.randomUUID()}`
  const isImage = file.type.startsWith('image/')
  const type = isImage ? 'image' : 'file'

  const safeFilename = file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'file'
  const yearMonth = new Date(now).toISOString().slice(0, 7)
  const fileKey = `transfers/${yearMonth}/${id}-${safeFilename}`

  try {
    await c.env.STORAGE.put(fileKey, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
      },
    })

    const note: TransferNote = {
      id,
      type,
      content: null,
      file_key: fileKey,
      file_name: file.name || 'file',
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
      created_at: now,
      expires_at: expiresAt,
    }

    await c.env.DB.prepare(
      'INSERT INTO transfer_notes (id, type, content, file_key, file_name, file_size, mime_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        note.id,
        note.type,
        note.content,
        note.file_key,
        note.file_name,
        note.file_size,
        note.mime_type,
        note.created_at,
        note.expires_at
      )
      .run()

    return c.json(ok(note))
  } catch (err) {
    console.error(err)
    return c.json(fail(ErrCode.SERVER_ERROR, 'failed to upload file'))
  }
})

// GET /api/transfers/file/:id - 获取/下载/预览文件
transfersRoutes.get('/file/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) return badRequest(c, 'missing id')

  try {
    const note = await c.env.DB.prepare(
      'SELECT * FROM transfer_notes WHERE id = ?'
    )
      .bind(id)
      .first<TransferNote>()

    if (!note || !note.file_key) {
      return new Response('File Not Found', { status: 404 })
    }

    if (note.expires_at && note.expires_at < Date.now()) {
      return new Response('File Expired', { status: 404 })
    }

    if (!c.env.STORAGE) {
      return new Response('Storage Unconfigured', { status: 500 })
    }

    const object = await c.env.STORAGE.get(note.file_key)
    if (!object) {
      return new Response('File Object Not Found', { status: 404 })
    }

    const headers = new Headers()
    headers.set('Content-Type', note.mime_type || 'application/octet-stream')
    if (note.file_size) {
      headers.set('Content-Length', String(note.file_size))
    }

    const encodedName = encodeURIComponent(note.file_name || 'file')
    if (note.type === 'image') {
      headers.set('Content-Disposition', `inline; filename="${encodedName}"`)
    } else {
      headers.set('Content-Disposition', `attachment; filename="${encodedName}"`)
    }
    headers.set('Cache-Control', 'private, max-age=3600')

    return new Response(object.body, { headers })
  } catch (err) {
    console.error(err)
    return new Response('Internal Server Error', { status: 500 })
  }
})

// DELETE /api/transfers/:id - 删除单条记录
transfersRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) return badRequest(c, 'missing id')

  try {
    const note = await c.env.DB.prepare(
      'SELECT file_key FROM transfer_notes WHERE id = ?'
    )
      .bind(id)
      .first<TransferNote>()

    if (note?.file_key && c.env.STORAGE) {
      try {
        await c.env.STORAGE.delete(note.file_key)
      } catch (storageErr) {
        console.error('Failed to delete R2 object:', storageErr)
      }
    }

    await c.env.DB.prepare('DELETE FROM transfer_notes WHERE id = ?')
      .bind(id)
      .run()

    return c.json(ok({ deleted: true }))
  } catch (err) {
    console.error(err)
    return c.json(fail(ErrCode.SERVER_ERROR, 'failed to delete transfer note'))
  }
})

// POST /api/transfers/clear - 一键清空所有
transfersRoutes.post('/clear', async (c) => {
  try {
    if (c.env.STORAGE) {
      const result = await c.env.DB.prepare(
        'SELECT file_key FROM transfer_notes WHERE file_key IS NOT NULL'
      ).all<TransferNote>()
      const results = result?.results ?? []
      const keys = results
        .map((r: TransferNote) => r.file_key)
        .filter((k: unknown): k is string => typeof k === 'string' && k.length > 0)
      if (keys.length > 0) {
        try {
          await c.env.STORAGE.delete(keys)
        } catch (storageErr) {
          console.error('Failed to clear R2 objects:', storageErr)
        }
      }
    }

    const deleteRes = await c.env.DB.prepare('DELETE FROM transfer_notes').run()
    const deletedCount = (deleteRes?.meta as any)?.changes ?? 0

    const resp: TransferClearResp = {
      success: true,
      deletedCount,
    }
    return c.json(ok(resp))
  } catch (err) {
    console.error(err)
    return c.json(fail(ErrCode.SERVER_ERROR, 'failed to clear transfers'))
  }
})
