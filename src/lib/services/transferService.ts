import type {
  TransferClearResp,
  TransferNote,
  TransferNotesResp,
} from '../../../shared/types'
import { getAuthToken, ApiError } from '../api'

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
  speed: number // bytes per second
}

export type UploadProgressCallback = (progress: UploadProgressEvent) => void

export interface UploadFileOptions {
  ttlDays?: number
  onProgress?: UploadProgressCallback
  signal?: AbortSignal
}

export const transferService = {
  async list(limit = 50, cursor?: number): Promise<TransferNotesResp> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (cursor) params.set('cursor', String(cursor))
    const token = getAuthToken()
    const res = await fetch(`/api/transfers?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const json = (await res.json()) as any
    if (json.code !== 0) throw new ApiError(json.msg || 'Failed to list transfers')
    return json.data
  },

  async sendText(content: string, ttlDays?: number): Promise<TransferNote> {
    const token = getAuthToken()
    const res = await fetch('/api/transfers/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, ttlDays }),
    })
    const json = (await res.json()) as any
    if (json.code !== 0) throw new ApiError(json.msg || 'Failed to send text')
    return json.data
  },

  async uploadFile(
    file: File,
    ttlDaysOrOptions?: number | UploadFileOptions,
    onProgressCallback?: UploadProgressCallback,
    signalParam?: AbortSignal
  ): Promise<TransferNote> {
    let ttlDays: number | undefined
    let onProgress: UploadProgressCallback | undefined
    let signal: AbortSignal | undefined

    if (typeof ttlDaysOrOptions === 'object' && ttlDaysOrOptions !== null) {
      ttlDays = ttlDaysOrOptions.ttlDays
      onProgress = ttlDaysOrOptions.onProgress
      signal = ttlDaysOrOptions.signal
    } else {
      ttlDays = ttlDaysOrOptions
      onProgress = onProgressCallback
      signal = signalParam
    }

    const token = getAuthToken()
    const formData = new FormData()
    formData.append('file', file)
    if (ttlDays) formData.append('ttlDays', String(ttlDays))

    if (typeof XMLHttpRequest === 'undefined') {
      const res = await fetch('/api/transfers/file', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
        signal,
      })
      const json = (await res.json()) as any
      if (json.code !== 0) throw new ApiError(json.msg || 'Failed to upload file')
      return json.data
    }

    return new Promise<TransferNote>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      let lastTime = Date.now()
      let lastLoaded = 0
      let currentSpeed = 0

      if (signal?.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }

      const handleAbort = () => {
        xhr.abort()
        reject(new DOMException('Upload aborted', 'AbortError'))
      }

      signal?.addEventListener('abort', handleAbort, { once: true })

      if (xhr.upload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && e.total > 0) {
            const now = Date.now()
            const timeDelta = (now - lastTime) / 1000
            if (timeDelta >= 0.2 || e.loaded === e.total) {
              const loadedDelta = e.loaded - lastLoaded
              currentSpeed = timeDelta > 0 ? Math.round(loadedDelta / timeDelta) : currentSpeed
              lastTime = now
              lastLoaded = e.loaded
            }

            const percent = Math.min(100, Math.round((e.loaded / e.total) * 100))
            onProgress?.({
              loaded: e.loaded,
              total: e.total,
              percent,
              speed: currentSpeed,
            })
          }
        })
      }

      xhr.addEventListener('load', () => {
        signal?.removeEventListener('abort', handleAbort)
        try {
          const json = JSON.parse(xhr.responseText)
          if (xhr.status >= 200 && xhr.status < 300 && json.code === 0) {
            resolve(json.data)
          } else {
            reject(new ApiError(json.msg || `Upload failed with status ${xhr.status}`))
          }
        } catch {
          reject(new ApiError(`Upload failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => {
        signal?.removeEventListener('abort', handleAbort)
        reject(new ApiError('Network error during file upload'))
      })

      xhr.addEventListener('timeout', () => {
        signal?.removeEventListener('abort', handleAbort)
        reject(new ApiError('Upload timed out'))
      })

      xhr.addEventListener('abort', () => {
        signal?.removeEventListener('abort', handleAbort)
        reject(new DOMException('Upload aborted', 'AbortError'))
      })

      xhr.open('POST', '/api/transfers/file')
      xhr.setRequestHeader('Accept', 'application/json')
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      xhr.send(formData)
    })
  },

  async delete(id: string): Promise<void> {
    const token = getAuthToken()
    const res = await fetch(`/api/transfers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const json = (await res.json()) as any
    if (json.code !== 0) throw new ApiError(json.msg || 'Failed to delete transfer')
  },

  async clear(): Promise<TransferClearResp> {
    const token = getAuthToken()
    const res = await fetch('/api/transfers/clear', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const json = (await res.json()) as any
    if (json.code !== 0) throw new ApiError(json.msg || 'Failed to clear transfers')
    return json.data
  },
}
