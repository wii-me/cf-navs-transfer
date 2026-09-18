// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte'
import TransferDrawer from '../../src/components/TransferDrawer.svelte'
import { transferStore } from '../../src/lib/stores/transferStore'

afterEach(cleanup)

describe('TransferDrawer Component', () => {
  beforeEach(() => {
    transferStore.reset()
  })

  it('does not render visible drawer when drawerOpen is false', () => {
    render(TransferDrawer)
    expect(screen.queryByTestId('transfer-drawer-panel')).toBeNull()
  })

  it('renders drawer when drawerOpen is true', () => {
    transferStore.openDrawer()
    render(TransferDrawer)
    expect(screen.getByTestId('transfer-drawer-panel')).toBeDefined()
    expect(screen.getByText('传输助手')).toBeDefined()
  })

  it('renders text note with copy button', () => {
    transferStore.openDrawer()
    transferStore.reset()
    transferStore.openDrawer()

    // populate a note
    const state = {
      notes: [
        {
          id: 't1',
          type: 'text' as const,
          content: 'Secret code: 123456',
          file_key: null,
          file_name: null,
          file_size: null,
          mime_type: null,
          created_at: Date.now(),
          expires_at: null,
        },
      ],
      loading: false,
      uploading: false,
      hasMore: false,
      drawerOpen: true,
      activeLightboxImage: null,
      error: null,
    }
    // @ts-ignore
    transferStore.set ? transferStore.set(state) : null

    render(TransferDrawer)
    expect(screen.getByText('Secret code: 123456')).toBeDefined()
    expect(screen.getByTestId('copy-text-t1')).toBeDefined()
  })

  it('renders image note with preview img and download button', () => {
    transferStore.openDrawer()
    const state = {
      notes: [
        {
          id: 'img_1',
          type: 'image' as const,
          content: null,
          file_key: 'transfers/test.png',
          file_name: 'test.png',
          file_size: 1024,
          mime_type: 'image/png',
          created_at: Date.now(),
          expires_at: null,
        },
      ],
      loading: false,
      uploading: false,
      hasMore: false,
      drawerOpen: true,
      activeLightboxImage: null,
      error: null,
    }
    // @ts-ignore
    transferStore.set ? transferStore.set(state) : null

    render(TransferDrawer)
    const img = screen.getByAltText('test.png') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toContain('/api/transfers/file/img_1')

    const downloadLink = screen.getByText('下载原图').closest('a') as HTMLAnchorElement
    expect(downloadLink).toBeDefined()
    expect(downloadLink.href).toContain('/api/transfers/file/img_1')
    expect(downloadLink.href).toContain('download=1')
  })

  it('closes when close button is clicked', async () => {
    transferStore.openDrawer()
    render(TransferDrawer)

    const closeBtn = screen.getByTestId('transfer-drawer-close')
    await fireEvent.click(closeBtn)

    // drawer should close
    expect(screen.queryByTestId('transfer-drawer-panel')).toBeNull()
  })
})
