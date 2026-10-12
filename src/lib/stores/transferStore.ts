import { writable } from 'svelte/store'
import type { TransferNote } from '../../../shared/types'
import { transferService, type UploadProgressEvent } from '../services/transferService'
import { getErrorMessage } from '../api'

export interface UploadProgressInfo {
  fileName: string
  fileSize: number
  loaded: number
  total: number
  percent: number
  speed: number // bytes per second
  eta: number // remaining seconds
  stage: 'uploading' | 'saving'
}

export interface TransferState {
  notes: TransferNote[]
  loading: boolean
  uploading: boolean
  uploadProgress: UploadProgressInfo | null
  hasMore: boolean
  drawerOpen: boolean
  activeLightboxImage: string | null
  error: string | null
}

const initialState: TransferState = {
  notes: [],
  loading: false,
  uploading: false,
  uploadProgress: null,
  hasMore: false,
  drawerOpen: false,
  activeLightboxImage: null,
  error: null,
}

export function createTransferStore(service = transferService) {
  const { subscribe, set, update } = writable<TransferState>({ ...initialState })
  let currentUploadAbortController: AbortController | null = null

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
      currentUploadAbortController = new AbortController()
      update((s) => ({
        ...s,
        uploading: true,
        error: null,
        uploadProgress: {
          fileName: file.name,
          fileSize: file.size,
          loaded: 0,
          total: file.size,
          percent: 0,
          speed: 0,
          eta: 0,
          stage: 'uploading',
        },
      }))

      const onProgress = (p: UploadProgressEvent) => {
        const eta = p.speed > 0 ? Math.max(0, Math.round((p.total - p.loaded) / p.speed)) : 0
        const stage = p.percent >= 100 ? 'saving' : 'uploading'
        update((s) => {
          if (!s.uploadProgress) return s
          return {
            ...s,
            uploadProgress: {
              ...s.uploadProgress,
              loaded: p.loaded,
              total: p.total,
              percent: p.percent,
              speed: p.speed,
              eta,
              stage,
            },
          }
        })
      }

      try {
        const note = await service.uploadFile(
          file,
          ttlDays,
          onProgress,
          currentUploadAbortController.signal
        )
        update((s) => ({
          ...s,
          notes: [note, ...s.notes],
          uploading: false,
          uploadProgress: null,
        }))
        currentUploadAbortController = null
        return true
      } catch (err: any) {
        const isAborted = err?.name === 'AbortError' || currentUploadAbortController?.signal.aborted
        currentUploadAbortController = null
        update((s) => ({
          ...s,
          uploading: false,
          uploadProgress: null,
          error: isAborted ? null : getErrorMessage(err),
        }))
        return false
      }
    },

    cancelUpload(): void {
      if (currentUploadAbortController) {
        currentUploadAbortController.abort()
        currentUploadAbortController = null
      }
      update((s) => ({
        ...s,
        uploading: false,
        uploadProgress: null,
      }))
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
      if (currentUploadAbortController) {
        currentUploadAbortController.abort()
        currentUploadAbortController = null
      }
      set({ ...initialState })
    },
  }
}

export const transferStore = createTransferStore()
