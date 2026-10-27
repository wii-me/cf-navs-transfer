import { describe, expect, it, vi } from 'vitest'
import {
  ICON_LOCAL_MAX_BYTES, IconQuotaError, createIconLocalStore, iconEpochToken, iconUrlHasAccessKey, iconVersionFromUrl,
  type IconFetchPayload, type IconLocalBackend, type LocalIconEntry,
} from '../../src/lib/iconLocalStore'

function memoryBackend(initial: LocalIconEntry[] = [], epoch: string | null = null) {
  const rows = new Map(initial.map(entry => [entry.key, entry]))
  const state = { epoch, puts: 0, deletes: [] as string[], failPut: null as Error | null }
  const backend: IconLocalBackend = {
    loadAll: async () => ({ entries: [...rows.values()], epoch: state.epoch }),
    put: async (entry) => { if (state.failPut) throw state.failPut; state.puts++; rows.set(entry.key, entry) },
    delete: async (keys) => { for (const key of keys) { rows.delete(key); state.deletes.push(key) } },
    setEpoch: async (value) => { state.epoch = value },
  }
  return { backend, rows, state }
}

const png = (size = 4) => new Blob([new Uint8Array(size)], { type: 'image/png' })
let urlSeq = 0
function store(backend: IconLocalBackend | null, fetchPayload: (url: string) => Promise<IconFetchPayload>, persist = vi.fn(async () => true)) {
  return createIconLocalStore({ backend, fetchPayload, createUrl: () => 'blob:' + ++urlSeq, revokeUrl: () => undefined, requestPersist: persist, warn: () => undefined })
}

describe('icon URL identity', () => {
  it('strips only the access key from the version', () => {
    expect(iconVersionFromUrl('/api/icon/3?v=abc&cv=2&key=secret')).toBe('/api/icon/3?v=abc&cv=2')
    expect(iconVersionFromUrl('/api/icon/3?key=secret')).toBe('/api/icon/3')
    expect(iconUrlHasAccessKey('/api/icon/3?v=1&key=s')).toBe(true)
    expect(iconUrlHasAccessKey('/api/icon/3?v=1')).toBe(false)
  })
  it('builds an epoch token only from complete metadata', () => {
    expect(iconEpochToken({ dataset_epoch: 'd', icon_epoch: 3 }, 'anonymous')).toBe('d:3:anonymous')
    expect(iconEpochToken({ dataset_epoch: 'd' }, 'admin')).toBe('')
    expect(iconEpochToken({ icon_epoch: 1 }, 'admin')).toBe('')
  })
})

describe('local-first icon store', () => {
  it('serves a persisted entry with the same version without any network request', async () => {
    const { backend } = memoryBackend([{ key: 'bookmark:1', version: '/api/icon/1?v=a', private: false, blob: png(), saved_at: 1 }])
    const fetchPayload = vi.fn()
    const local = store(backend, fetchPayload)
    await local.ready
    expect(local.peek('bookmark:1', '/api/icon/1?v=a')).toMatch(/^blob:/)
    expect(await local.resolve('bookmark:1', '/api/icon/1?v=a', '/api/icon/1?v=a', false)).toMatch(/^blob:/)
    expect(fetchPayload).not.toHaveBeenCalled()
  })

  it('re-downloads and replaces the entry when the version changed', async () => {
    const { backend, rows } = memoryBackend([{ key: 'bookmark:1', version: '/api/icon/1?v=old', private: false, blob: png(), saved_at: 1 }])
    const fetchPayload = vi.fn(async () => ({ blob: png(8), status: 'ready' as const }))
    const local = store(backend, fetchPayload)
    expect(await local.resolve('bookmark:1', '/api/icon/1?v=new', '/api/icon/1?v=new', false)).toMatch(/^blob:/)
    expect(fetchPayload).toHaveBeenCalledTimes(1)
    expect(rows.get('bookmark:1')?.version).toBe('/api/icon/1?v=new')
  })

  it('coalesces concurrent misses for the same object and version', async () => {
    const { backend } = memoryBackend()
    let release!: (value: IconFetchPayload) => void
    const fetchPayload = vi.fn(() => new Promise<IconFetchPayload>(resolve => { release = resolve }))
    const local = store(backend, fetchPayload)
    await local.ready
    const a = local.resolve('category:2', '/api/category-icon/2?v=1', '/api/category-icon/2?v=1', false)
    const b = local.resolve('category:2', '/api/category-icon/2?v=1', '/api/category-icon/2?v=1', false)
    await Promise.resolve()
    release({ blob: png(), status: 'ready' })
    expect(await a).toBe(await b)
    expect(fetchPayload).toHaveBeenCalledTimes(1)
  })

  it('never persists fallback or failed responses', async () => {
    const { backend, state } = memoryBackend()
    const local = store(backend, async () => ({ blob: png(), status: 'retryable' }))
    expect(await local.resolve('bookmark:9', '/api/icon/9?v=1', '/api/icon/9?v=1', false)).toBeNull()
    expect(state.puts).toBe(0)
  })

  it('displays but does not persist images over 512 KiB, and requests persistent storage once', async () => {
    const { backend, state } = memoryBackend()
    const persist = vi.fn(async () => true)
    const local = store(backend, async () => ({ blob: png(ICON_LOCAL_MAX_BYTES + 1), status: 'ready' }), persist)
    expect(await local.resolve('bookmark:3', '/api/icon/3?v=1', '/api/icon/3?v=1', false)).toMatch(/^blob:/)
    expect(state.puts).toBe(0)
    const small = store(backend, async () => ({ blob: png(), status: 'ready' }), persist)
    await small.resolve('bookmark:4', '/api/icon/4?v=1', '/api/icon/4?v=1', false)
    await small.resolve('bookmark:5', '/api/icon/5?v=1', '/api/icon/5?v=1', false)
    expect(state.puts).toBe(2)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('keeps working from memory when the quota is full', async () => {
    const { backend, state } = memoryBackend()
    state.failPut = new IconQuotaError('quota')
    const local = store(backend, async () => ({ blob: png(), status: 'ready' }))
    const url = await local.resolve('bookmark:1', '/api/icon/1?v=1', '/api/icon/1?v=1', false)
    expect(url).toMatch(/^blob:/)
    expect(local.peek('bookmark:1', '/api/icon/1?v=1')).toBe(url)
  })

  it('falls back to memory only when IndexedDB is unavailable', async () => {
    const local = store(null, async () => ({ blob: png(), status: 'ready' }))
    expect(await local.resolve('bookmark:1', '/api/icon/1?v=1', '/api/icon/1?v=1', false)).toMatch(/^blob:/)
  })

  it('clears only private entries', async () => {
    const { backend, rows } = memoryBackend([
      { key: 'bookmark:1', version: 'a', private: false, blob: png(), saved_at: 1 },
      { key: 'bookmark:2', version: 'b', private: true, blob: png(), saved_at: 1 },
    ])
    const local = store(backend, vi.fn())
    await local.clearPrivate()
    expect([...rows.keys()]).toEqual(['bookmark:1'])
    expect(local.peek('bookmark:2', 'b')).toBeNull()
    expect(local.peek('bookmark:1', 'a')).toMatch(/^blob:/)
  })

  it('reconciles against live objects only when the epoch changes', async () => {
    const { backend, rows, state } = memoryBackend([
      { key: 'bookmark:1', version: 'a', private: false, blob: png(), saved_at: 1 },
      { key: 'bookmark:2', version: 'b', private: false, blob: png(), saved_at: 1 },
    ], 'd:1:anonymous')
    const local = store(backend, vi.fn())
    expect(await local.reconcile('d:1:anonymous', new Set(['bookmark:1']))).toBe(false)
    expect(rows.size).toBe(2)
    expect(await local.reconcile('d:2:anonymous', new Set(['bookmark:1']))).toBe(true)
    expect([...rows.keys()]).toEqual(['bookmark:1'])
    expect(state.epoch).toBe('d:2:anonymous')
  })

  it('invalidates a broken entry so the next view downloads it again', async () => {
    const { backend, rows } = memoryBackend([{ key: 'bookmark:1', version: 'a', private: false, blob: png(), saved_at: 1 }])
    const local = store(backend, vi.fn())
    await local.ready
    local.invalidate('bookmark:1', 'a')
    expect(local.peek('bookmark:1', 'a')).toBeNull()
    await Promise.resolve()
    expect(rows.size).toBe(0)
  })
})

describe('cold-start fast path', () => {
  function hintOf(initial: boolean | null) {
    const state = { value: initial, sets: [] as boolean[] }
    return { state, hint: { get: () => state.value, set: (v: boolean) => { state.sets.push(v); state.value = v } } }
  }
  function slowBackend() {
    const base = memoryBackend()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const backend: IconLocalBackend = { ...base.backend, loadAll: async () => { await gate; return base.backend.loadAll() } }
    return { ...base, backend, release }
  }

  it('downloads without waiting for the database on a first visit (hint says empty)', async () => {
    const { backend, rows, release } = slowBackend()
    const { hint, state } = hintOf(false)
    const fetchPayload = vi.fn(async () => ({ blob: png(), status: 'ready' as const }))
    const local = createIconLocalStore({ backend, fetchPayload, hint, createUrl: () => 'blob:x', revokeUrl: () => undefined, requestPersist: async () => true, warn: () => undefined })
    expect(await local.resolve('bookmark:1', '/api/icon/1?v=a', '/api/icon/1?v=a', false)).toBe('blob:x')
    expect(fetchPayload).toHaveBeenCalledTimes(1)
    expect(rows.get('bookmark:1')?.version).toBe('/api/icon/1?v=a')
    expect(state.sets).toEqual([true])
    release()
    await local.ready
    expect(local.peek('bookmark:1', '/api/icon/1?v=a')).toBe('blob:x')
  })

  it('still waits for the database when the hint says entries may exist or is unknown', async () => {
    for (const initial of [true, null]) {
      const { backend, release } = slowBackend()
      const fetchPayload = vi.fn(async () => ({ blob: png(), status: 'ready' as const }))
      const local = createIconLocalStore({ backend, fetchPayload, hint: hintOf(initial).hint, createUrl: () => 'blob:y', revokeUrl: () => undefined, warn: () => undefined })
      const pending = local.resolve('bookmark:2', '/api/icon/2?v=a', '/api/icon/2?v=a', false)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(fetchPayload).not.toHaveBeenCalled()
      release()
      await pending
      expect(fetchPayload).toHaveBeenCalledTimes(1)
    }
  })

  it('falls back to memory when the database never opens', async () => {
    vi.useFakeTimers()
    try {
      const backend: IconLocalBackend = { ...memoryBackend().backend, loadAll: () => new Promise(() => undefined), put: vi.fn(async () => undefined) }
      const fetchPayload = vi.fn(async () => ({ blob: png(), status: 'ready' as const }))
      const local = createIconLocalStore({ backend, fetchPayload, readyTimeoutMs: 100, createUrl: () => 'blob:z', revokeUrl: () => undefined, warn: () => undefined })
      const pending = local.resolve('bookmark:3', '/api/icon/3?v=a', '/api/icon/3?v=a', false)
      await vi.advanceTimersByTimeAsync(100)
      expect(await pending).toBe('blob:z')
      expect(backend.put).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
