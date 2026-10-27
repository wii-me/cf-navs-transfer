// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import GuideOverlay from '../../src/components/GuideOverlay.svelte'

const guideHtml = `<!doctype html>
<html><head><style>.guide-backdrop { color: red; }</style></head>
<body><div id="guideBackdrop" class="guide-backdrop" role="dialog" aria-label="使用指南">
<button id="guideCloseBtn">关闭</button><button id="guideNextBtn">下一步</button></div></body></html>`
type GuideWindow = Window & {
  __CF_NAVS_GUIDE_CONFIG__?: {
    embedded: true
    theme: 'light' | 'dark'
    accentColor: string
    cardStyle: 'info' | 'icon'
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as GuideWindow).__CF_NAVS_GUIDE_CONFIG__
})

describe('guide overlay', () => {
  it('keeps the guide unloaded until opened', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(GuideOverlay, { props: { open: false } })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.querySelector('.guide-backdrop')).toBeNull()
  })

  it('injects the standalone guide with current theme and bookmark style', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(guideHtml, { status: 200 })))
    render(GuideOverlay, {
      props: { open: true, activeTheme: 'dark', accentColor: '#aabbcc', cardStyle: 'icon' },
    })

    await waitFor(() => expect(document.querySelector('.guide-backdrop')).not.toBeNull())

    expect((window as GuideWindow).__CF_NAVS_GUIDE_CONFIG__).toEqual({
      embedded: true,
      theme: 'dark',
      accentColor: '#aabbcc',
      cardStyle: 'icon',
    })
    expect(document.querySelector('.guide-injected style')?.textContent).toContain('.guide-backdrop')
  })

  it('closes when the guide script sends its same-page close event', async () => {
    const onClose = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(guideHtml, { status: 200 })))
    render(GuideOverlay, { props: { open: true, onClose } })
    await waitFor(() => expect(document.querySelector('.guide-backdrop')).not.toBeNull())

    window.dispatchEvent(new Event('cf-navs:guide:close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('retries after the same-origin guide request fails', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce(new Response(guideHtml, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(GuideOverlay, { props: { open: true } })

    await screen.findByRole('alert')
    await fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(document.querySelector('.guide-backdrop')).not.toBeNull())

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab focus inside the injected guide', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(guideHtml, { status: 200 })))
    render(GuideOverlay, { props: { open: true } })
    await waitFor(() => expect(document.querySelector('.guide-backdrop')).not.toBeNull())

    const close = document.getElementById('guideCloseBtn')
    const next = document.getElementById('guideNextBtn')
    const firstTab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    window.dispatchEvent(firstTab)
    expect(firstTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    next?.focus()
    const lastTab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    window.dispatchEvent(lastTab)
    expect(lastTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
  })
})
