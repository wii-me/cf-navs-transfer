import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { createTransferStore } from '../../src/lib/stores/transferStore'
import type { TransferNote } from '../../shared/types'

describe('Transfer Store', () => {
  let mockService: any
  let store: ReturnType<typeof createTransferStore>

  beforeEach(() => {
    mockService = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'n1',
            type: 'text',
            content: 'hello',
            file_key: null,
            file_name: null,
            file_size: null,
            mime_type: null,
            created_at: 1000,
            expires_at: null,
          } as TransferNote,
        ],
        hasMore: false,
      }),
      sendText: vi.fn().mockImplementation(async (content: string, ttlDays?: number) => {
        return {
          id: 'n2',
          type: 'text',
          content,
          file_key: null,
          file_name: null,
          file_size: null,
          mime_type: null,
          created_at: 2000,
          expires_at: ttlDays ? 2000 + ttlDays * 86400000 : null,
        } as TransferNote
      }),
      uploadFile: vi.fn().mockImplementation(async (file: File, ttlDays?: number) => {
        return {
          id: 'n3',
          type: 'image',
          content: null,
          file_key: 'transfers/img.png',
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          created_at: 3000,
          expires_at: null,
        } as TransferNote
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue({ success: true, deletedCount: 1 }),
    }

    store = createTransferStore(mockService)
  })

  it('has correct initial state', () => {
    const state = get(store)
    expect(state.notes).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.uploading).toBe(false)
    expect(state.drawerOpen).toBe(false)
    expect(state.activeLightboxImage).toBeNull()
  })

  it('fetches notes into store', async () => {
    await store.fetchNotes()
    const state = get(store)
    expect(mockService.list).toHaveBeenCalled()
    expect(state.notes).toHaveLength(1)
    expect(state.notes[0].id).toBe('n1')
    expect(state.loading).toBe(false)
  })

  it('sends text and prepends to notes list', async () => {
    await store.fetchNotes()
    const success = await store.sendText('new message', 7)
    expect(success).toBe(true)
    expect(mockService.sendText).toHaveBeenCalledWith('new message', 7)

    const state = get(store)
    expect(state.notes).toHaveLength(2)
    expect(state.notes[0].id).toBe('n2')
  })

  it('uploads file and prepends to notes list', async () => {
    const file = new File(['123'], 'screenshot.png', { type: 'image/png' })
    const success = await store.uploadFile(file)
    expect(success).toBe(true)
    expect(mockService.uploadFile).toHaveBeenCalledWith(file, undefined)

    const state = get(store)
    expect(state.notes).toHaveLength(1)
    expect(state.notes[0].id).toBe('n3')
    expect(state.notes[0].file_name).toBe('screenshot.png')
  })

  it('deletes note from store', async () => {
    await store.fetchNotes()
    expect(get(store).notes).toHaveLength(1)

    const success = await store.deleteNote('n1')
    expect(success).toBe(true)
    expect(mockService.delete).toHaveBeenCalledWith('n1')
    expect(get(store).notes).toHaveLength(0)
  })

  it('clears all notes in store', async () => {
    await store.fetchNotes()
    expect(get(store).notes).toHaveLength(1)

    const success = await store.clearAll()
    expect(success).toBe(true)
    expect(mockService.clear).toHaveBeenCalled()
    expect(get(store).notes).toHaveLength(0)
  })

  it('toggles drawer state and lightbox', () => {
    expect(get(store).drawerOpen).toBe(false)
    store.openDrawer()
    expect(get(store).drawerOpen).toBe(true)
    store.closeDrawer()
    expect(get(store).drawerOpen).toBe(false)
    store.toggleDrawer()
    expect(get(store).drawerOpen).toBe(true)

    store.openLightbox('/api/transfers/file/n3')
    expect(get(store).activeLightboxImage).toBe('/api/transfers/file/n3')
    store.closeLightbox()
    expect(get(store).activeLightboxImage).toBeNull()
  })
})
