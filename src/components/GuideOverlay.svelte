<svelte:options runes />

<script lang="ts">
  type GuideTheme = 'light' | 'dark'
  type GuideCardStyle = 'info' | 'icon'

  interface GuideConfig {
    embedded: true
    theme: GuideTheme
    accentColor: string
    cardStyle: GuideCardStyle
  }

  type GuideWindow = Window & { __CF_NAVS_GUIDE_CONFIG__?: GuideConfig }

  interface Props {
    open?: boolean
    activeTheme?: GuideTheme
    accentColor?: string
    cardStyle?: GuideCardStyle
    onClose?: () => void
  }

  let {
    open = false,
    activeTheme = 'light',
    accentColor = '#2563eb',
    cardStyle = 'info',
    onClose,
  }: Props = $props()

  let guideMarkup = $state('')
  let loadError = $state(false)
  let isLoading = $state(false)
  let contentEl: HTMLDivElement | null = $state(null)
  let scriptEl: HTMLScriptElement | null = null
  let scriptLoaded = false
  let waitingForOpen = false
  let wasOpen = false

  function updateGuideConfig(): void {
    const guideWindow = window as GuideWindow
    const current = guideWindow.__CF_NAVS_GUIDE_CONFIG__ ?? {
      embedded: true as const,
      theme: activeTheme,
      accentColor,
      cardStyle,
    }
    Object.assign(current, { embedded: true as const, theme: activeTheme, accentColor, cardStyle })
    guideWindow.__CF_NAVS_GUIDE_CONFIG__ = current
  }

  function dispatchGuideOpen(): void {
    window.dispatchEvent(new CustomEvent('cf-navs:guide:open'))
    document.getElementById('guideCloseBtn')?.focus()
    waitingForOpen = false
  }

  async function loadGuide(): Promise<void> {
    if (guideMarkup || isLoading || loadError) return
    isLoading = true
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}guide/`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Guide request failed with HTTP ${response.status}`)

      const document = new DOMParser().parseFromString(await response.text(), 'text/html')
      const css = document.querySelector('style')?.textContent
      const guideBody = document.body
      if (!css || !guideBody.querySelector('#guideBackdrop')) throw new Error('Guide markup is incomplete')

      guideBody.querySelectorAll('script').forEach((script) => script.remove())
      guideMarkup = `<style>${css}</style>${guideBody.innerHTML}`
    } catch {
      loadError = true
    } finally {
      isLoading = false
    }
  }

  function loadGuideScript(): void {
    if (scriptEl || !contentEl) return

    /* eslint-disable svelte/no-dom-manipulating -- Inject the same-origin guide script; innerHTML does not execute it. */
    const script = document.createElement('script')
    script.src = `${import.meta.env.BASE_URL}guide/guide.js`
    script.async = true
    script.onload = () => {
      scriptLoaded = true
      if (waitingForOpen && open) dispatchGuideOpen()
    }
    script.onerror = () => {
      loadError = true
    }
    scriptEl = script
    contentEl.appendChild(script)
    /* eslint-enable svelte/no-dom-manipulating */
  }

  function handleGuideClose(): void {
    onClose?.()
  }

  function retryGuideLoad(): void {
    loadError = false
    if (guideMarkup) {
      scriptEl = null
      scriptLoaded = false
      waitingForOpen = true
      loadGuideScript()
    } else {
      void loadGuide()
    }
  }

  function handleGuideTab(event: KeyboardEvent): void {
    if (!open || event.key !== 'Tab') return
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      '.guide-backdrop button:not(:disabled), .guide-backdrop [href], .guide-backdrop input, .guide-backdrop select, .guide-backdrop textarea, .guide-backdrop [tabindex]:not([tabindex="-1"])',
    )).filter((control) => control.tabIndex >= 0 && getComputedStyle(control).visibility !== 'hidden')
    if (controls.length === 0) return

    const first = controls[0]
    const last = controls[controls.length - 1]
    const active = document.activeElement
    if (!contentEl?.contains(active)) {
      const target = event.shiftKey ? last : first
      event.preventDefault()
      target.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true
      waitingForOpen = true
      updateGuideConfig()
      if (scriptLoaded) dispatchGuideOpen()
      else if (guideMarkup) loadGuideScript()
      else void loadGuide()
    } else if (!open) {
      wasOpen = false
    }
  })

  $effect(() => {
    if (open) {
      window.addEventListener('cf-navs:guide:close', handleGuideClose)
      window.addEventListener('keydown', handleGuideTab)
      return () => {
        window.removeEventListener('cf-navs:guide:close', handleGuideClose)
        window.removeEventListener('keydown', handleGuideTab)
      }
    }
  })

  $effect(() => {
    if (guideMarkup && contentEl && open) loadGuideScript()
  })
</script>

<div
  class="guide-injection-host"
  class:closed={!open}
  data-testid="home-guide-overlay"
  aria-hidden={!open}
  inert={!open}
>
  {#if loadError}
    <div class="guide-status" role="dialog" aria-modal="true" aria-label="使用指南">
      <p role="alert">指南加载失败，请检查网络后重试。</p>
      <button type="button" class="guide-status-retry" onclick={retryGuideLoad}>重试</button>
      <button type="button" class="guide-status-close" onclick={handleGuideClose} aria-label="关闭指南">×</button>
    </div>
  {:else if guideMarkup}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- The markup comes from this site's static guide page. -->
    <div class="guide-injected" bind:this={contentEl}>{@html guideMarkup}</div>
  {:else if open}
    <div class="guide-status" role="dialog" aria-modal="true" aria-label="使用指南">
      <p>正在加载指南…</p>
      <button type="button" class="guide-status-close" onclick={handleGuideClose} aria-label="关闭指南">×</button>
    </div>
  {/if}
</div>

<style>
  .guide-injection-host {
    position: fixed;
    inset: 0;
    z-index: 2400;
  }

  .guide-injection-host.closed {
    display: none;
  }

  .guide-injected {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .guide-status {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    background: rgba(8, 14, 24, 0.58);
    color: #f8fafc;
    font-size: 14px;
  }

  .guide-status-close {
    position: fixed;
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
    width: 40px;
    height: 40px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    background: rgba(15, 23, 42, 0.76);
    color: #fff;
    font-size: 20px;
    cursor: pointer;
  }

  .guide-status-retry {
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 7px;
    background: rgba(15, 23, 42, 0.76);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
  }
</style>
