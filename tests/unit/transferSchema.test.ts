import { describe, it, expect } from 'vitest'
import type { TransferNote, TransferType, TransferTextReq } from '../../shared/types'

describe('Transfer Note Types & Schema', () => {
  it('validates TransferNote data structure contract', () => {
    const note: TransferNote = {
      id: 'tn_123456',
      type: 'text',
      content: 'Hello cross-device!',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: Date.now(),
      expires_at: Date.now() + 86400000,
    }
    expect(note.id).toBe('tn_123456')
    expect(note.type).toBe('text')
    expect(note.content).toBe('Hello cross-device!')
    expect(note.expires_at).toBeGreaterThan(note.created_at)
  })

  it('supports image and file transfer types', () => {
    const types: TransferType[] = ['text', 'image', 'file']
    expect(types).toHaveLength(3)

    const fileNote: TransferNote = {
      id: 'tn_img_1',
      type: 'image',
      content: null,
      file_key: 'transfers/2026-09/screenshot.png',
      file_name: 'screenshot.png',
      file_size: 102400,
      mime_type: 'image/png',
      created_at: 1726412345000,
      expires_at: null,
    }
    expect(fileNote.type).toBe('image')
    expect(fileNote.file_size).toBe(102400)
    expect(fileNote.expires_at).toBeNull()
  })

  it('supports TransferTextReq with optional ttlDays', () => {
    const req: TransferTextReq = {
      content: 'Quick note',
      ttlDays: 7,
    }
    expect(req.content).toBe('Quick note')
    expect(req.ttlDays).toBe(7)
  })
})
