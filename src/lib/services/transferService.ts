import type {
  TransferClearResp,
  TransferNote,
  TransferNotesResp,
} from '../../../shared/types'
import { getAuthToken, ApiError } from '../api'

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

  async uploadFile(file: File, ttlDays?: number): Promise<TransferNote> {
    const token = getAuthToken()
    const formData = new FormData()
    formData.append('file', file)
    if (ttlDays) formData.append('ttlDays', String(ttlDays))

    const res = await fetch('/api/transfers/file', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })
    const json = (await res.json()) as any
    if (json.code !== 0) throw new ApiError(json.msg || 'Failed to upload file')
    return json.data
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
