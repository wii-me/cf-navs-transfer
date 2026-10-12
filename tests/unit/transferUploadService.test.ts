// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transferService } from '../../src/lib/services/transferService'

describe('transferService uploadFile with XHR and progress', () => {
  let originalXHR: any
  let mockXHR: any

  beforeEach(() => {
    originalXHR = window.XMLHttpRequest
  })

  afterEach(() => {
    window.XMLHttpRequest = originalXHR
  })

  it('reports progress events and resolves note on load', async () => {
    const progressCalls: any[] = []
    let uploadProgressHandler: any
    let loadHandler: any

    class MockXMLHttpRequest {
      upload = {
        addEventListener: vi.fn((event: string, handler: any) => {
          if (event === 'progress') uploadProgressHandler = handler
        }),
      }
      open = vi.fn()
      setRequestHeader = vi.fn()
      send = vi.fn(() => {
        // simulate progress
        if (uploadProgressHandler) {
          uploadProgressHandler({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          })
          uploadProgressHandler({
            lengthComputable: true,
            loaded: 100,
            total: 100,
          })
        }
        if (loadHandler) {
          this.status = 200
          this.responseText = JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { id: 'tn_123', type: 'file', file_name: 'doc.txt' },
          })
          loadHandler()
        }
      })
      status = 200
      responseText = ''
      addEventListener = vi.fn((event: string, handler: any) => {
        if (event === 'load') loadHandler = handler
      })
      removeEventListener = vi.fn()
      abort = vi.fn()
    }

    // @ts-ignore
    window.XMLHttpRequest = MockXMLHttpRequest

    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    const note = await transferService.uploadFile(file, {
      ttlDays: 7,
      onProgress: (p) => progressCalls.push(p),
    })

    expect(note.id).toBe('tn_123')
    expect(progressCalls.length).toBeGreaterThanOrEqual(1)
    expect(progressCalls[progressCalls.length - 1].percent).toBe(100)
  })

  it('aborts upload when AbortSignal triggers', async () => {
    let abortHandler: any
    const abortSpy = vi.fn()

    class MockXMLHttpRequest {
      upload = { addEventListener: vi.fn() }
      open = vi.fn()
      setRequestHeader = vi.fn()
      send = vi.fn()
      status = 0
      responseText = ''
      addEventListener = vi.fn((event: string, handler: any) => {
        if (event === 'abort') abortHandler = handler
      })
      removeEventListener = vi.fn()
      abort = abortSpy
    }

    // @ts-ignore
    window.XMLHttpRequest = MockXMLHttpRequest

    const controller = new AbortController()
    const file = new File(['content'], 'cancel.dat')

    const uploadPromise = transferService.uploadFile(file, {
      signal: controller.signal,
    })

    controller.abort()
    expect(abortSpy).toHaveBeenCalled()

    if (abortHandler) abortHandler()

    await expect(uploadPromise).rejects.toThrow()
  })
})
