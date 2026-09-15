import { writable } from 'svelte/store'
import type { TransferNote } from '../../../shared/types'
import { transferService } from '../services/transferService'
import { getErrorMessage } from '../api'

export interface TransferState {
  notes: TransferNote[]
  loading: boolean
  uploading: boolean
  hasMore: boolean
  drawerOpen: boolean
  activeLightboxImage: string | null
  error: string | null
}

const initialState: TransferState = {
  notes: [],
  loading: false,
  uploading: false,
  hasMore: false,
  drawerOpen: false,
  activeLightboxImage: null,
  error: null,
}

export function createTransferStore(service = transferService) {
  const { subscribe, set, update } = writable<TransferState>({ ...initialState })

  return {
    subscribe,
    set,

    async fetchNotes(cursor?: number): Promise<void> {
      update((s) => ({ ...s, loading: true, error: null }))
      try {
        const resp = await service.list(50, cursor)
        update((s) => ({
          ...s,
          notes: cursor ? [...s.notes, ...resp.items] : resp.items,
          hasMore: resp.hasMore,
          loading: false,
        }))
      } catch (err) {
        update((s) => ({ ...s, loading: false, error: getErrorMessage(err) }))
      }
    },

    async sendText(content: string, ttlDays?: number): Promise<boolean> {
      update((s) => ({ ...s, uploading: true, error: null }))
      try {
        const note = await service.sendText(content, ttlDays)
        update((s) => ({
          ...s,
          notes: [note, ...s.notes],
          uploading: false,
        }))
        return true
      } catch (err) {
        update((s) => ({ ...s, uploading: false, error: getErrorMessage(err) }))
        return false
      }
    },

    async uploadFile(file: File, ttlDays?: number): Promise<boolean> {
      update((s) => ({ ...s, uploading: true, error: null }))
      try {
        const note = await service.uploadFile(file, ttlDays)
        update((s) => ({
          ...s,
          notes: [note, ...s.notes],
          uploading: false,
        }))
        return true
      } catch (err) {
        update((s) => ({ ...s, uploading: false, error: getErrorMessage(err) }))
        return false
      }
    },

    async deleteNote(id: string): Promise<boolean> {
      try {
        await service.delete(id)
        update((s) => ({
          ...s,
          notes: s.notes.filter((n) => n.id !== id),
        }))
        return true
      } catch (err) {
        update((s) => ({ ...s, error: getErrorMessage(err) }))
        return false
      }
    },

    async clearAll(): Promise<boolean> {
      try {
        await service.clear()
        update((s) => ({
          ...s,
          notes: [],
          hasMore: false,
        }))
        return true
      } catch (err) {
        update((s) => ({ ...s, error: getErrorMessage(err) }))
        return false
      }
    },

    openDrawer(): void {
      update((s) => ({ ...s, drawerOpen: true }))
    },

    closeDrawer(): void {
      update((s) => ({ ...s, drawerOpen: false }))
    },

    toggleDrawer(): void {
      update((s) => ({ ...s, drawerOpen: !s.drawerOpen }))
    },

    openLightbox(imageUrl: string): void {
      update((s) => ({ ...s, activeLightboxImage: imageUrl }))
    },

    closeLightbox(): void {
      update((s) => ({ ...s, activeLightboxImage: null }))
    },

    reset(): void {
      set({ ...initialState })
    },
  }
}

export const transferStore = createTransferStore()
