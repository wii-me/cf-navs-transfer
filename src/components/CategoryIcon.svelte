<svelte:options runes />

<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { createIconRetry } from '../lib/iconRetry'
  import { createNativeImageWatchdog } from '../lib/nativeImageWatchdog'
  import type { CategoryIconValue } from '../lib/categoryIconDisplay'
  import {
    getCategoryIconFallbackText,
    createCategoryRetryUrl,
    getCategoryImageIconUrl,
    getCategoryTextIcon,
    normalizeCategoryIcon,
  } from '../lib/categoryIconDisplay'
  import { withIconAccessKey } from '../lib/iconAccessKey'
  import { createLocalIconView, emptyLocalIcon, type LocalIconState } from '../lib/localIconView'

  interface Props {
    category: CategoryIconValue
    size?: number | string
    className?: string
    label?: string
    iconAccessKey?: string
    imageLoading?: 'lazy' | 'eager'
    preview?: boolean
  }

  let {
    category,
    size = 36,
    className = '',
    label = '',
    iconAccessKey = '',
    imageLoading = 'lazy',
    preview = false,
  }: Props = $props()

  // 本地图标视图每次发布新对象；不做深层代理。
  let localState: LocalIconState = $state.raw(emptyLocalIcon)
  const localView = createLocalIconView(value => { localState = value })

  // One native source owns its retry budget. Blob failures remain with the
  // local-icon owner; native fallbacks also need recovery while it is active.
  let sourceUrl = $state('')
  let retryUrl = $state('')
  let failedUrl = $state('')
  // 只在重试回调里读写，不进模板。
  let retryAttempt = 0
  const nativeRetry = createIconRetry(() => {
    retryAttempt += 1
    retryUrl = createCategoryRetryUrl(sourceUrl, retryAttempt, performance.timeOrigin)
  })

  const iconValue = $derived(normalizeCategoryIcon(category) || category.icon_display === 'image')
  const previewValue = $derived(normalizeCategoryIcon(category))
  const previewSource = $derived(/^data:image\//i.test(previewValue) ? previewValue : /^https?:\/\//i.test(previewValue) ? previewValue : '')
  const nextImageUrl = $derived(preview ? previewSource : withIconAccessKey(getCategoryImageIconUrl(category), iconAccessKey))
  // 原 `$:` 经拓扑排序后在 nextImageUrl 之后、换源判断之前执行；set 内部按签名去重。
  $effect.pre(() => {
    const input = { object_type: 'category' as const, id: Number(category.id), icon: category.icon, icon_blob: category.icon_blob,
      icon_revision: category.icon_revision, icon_write_epoch: category.icon_write_epoch, icon_display: category.icon_display,
      visible: true, preview, online_url: nextImageUrl }
    untrack(() => localView.set(input))
  })
  const selectedUrl = $derived(localState.active ? localState.url : nextImageUrl)
  // 换源时复位重试与失败标记；只依赖 selectedUrl，先于 DOM 更新。
  $effect.pre(() => {
    const nextUrl = selectedUrl
    untrack(() => {
      if (nextUrl === sourceUrl) return
      sourceUrl = nextUrl
      retryUrl = ''
      failedUrl = ''
      retryAttempt = 0
      nativeRetry.reset()
    })
  })
  const nativeSource = $derived(!preview && sourceUrl.startsWith('/api/category-icon/'))
  const isLocalBlob = $derived(localState.active && sourceUrl.startsWith('blob:'))
  const imageUrl = $derived(nativeSource ? retryUrl || sourceUrl : sourceUrl)
  const textIcon = $derived(getCategoryTextIcon(category))

  function handleImageError(): void {
    if (isLocalBlob) { localView.failed(); return }
    failedUrl = imageUrl
    if (nativeSource) nativeRetry.failed()
  }

  function handleImageLoad(): void {
    if (nativeSource) nativeRetry.reset()
    // Keep retryUrl: reverting to the stalled original would restart the failure.
  }

  function watchNativeImage(node: HTMLImageElement, url: string) {
    let watchdog: ReturnType<typeof createNativeImageWatchdog> | null = null
    const update = (nextUrl: string) => {
      const enabled = !preview && nextUrl.startsWith('/api/category-icon/')
      if (!enabled) { watchdog?.destroy(); watchdog = null; return }
      watchdog ??= createNativeImageWatchdog(node, expiredUrl => {
        if (imageUrl === expiredUrl && nativeSource) handleImageError()
      })
      watchdog.update({ url: nextUrl, enabled: true })
    }
    update(url)
    return { update, destroy: () => watchdog?.destroy() }
  }

  onDestroy(() => { nativeRetry.dispose(); localView.destroy() })
</script>

{#if iconValue}
  <span
    class={`category-icon ${className}`.trim()}
    style={`--category-icon-size: ${typeof size === 'number' ? `${size}px` : size}`}
    data-category-icon
    aria-hidden={label ? undefined : 'true'}
    aria-label={label || undefined}
  >
    {#if imageUrl && (isLocalBlob || imageUrl !== failedUrl)}
      <img src={imageUrl} alt="" loading={imageLoading} decoding="async" use:watchNativeImage={imageUrl} onload={handleImageLoad} onerror={handleImageError} />
    {:else if textIcon}
      <span class="category-icon-text">{textIcon}</span>
    {:else}
      <span class="category-icon-text category-icon-fallback">{getCategoryIconFallbackText(category)}</span>
    {/if}
  </span>
{/if}

<style>
  .category-icon {
    width: var(--category-icon-size, 36px);
    height: var(--category-icon-size, 36px);
    min-width: var(--category-icon-size, 36px);
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--home-text-color, #0f172a) 14%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--home-stat-bg, rgba(255, 255, 255, 0.5)) 84%, transparent);
    color: var(--home-text-color, #0f172a);
    line-height: 1;
  }

  .category-icon img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  :global(.admin-icon-badge.category-icon) {
    border: 0;
    border-radius: 8px;
    background: var(--admin-icon-badge-bg, var(--home-stat-bg, rgba(255, 255, 255, 0.5)));
    color: var(--admin-subtle, var(--home-text-color, #0f172a));
  }

  :global(.admin-icon-badge.category-icon) img {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  .category-icon-text {
    max-width: 100%;
    padding: 0.15em;
    overflow: hidden;
    font-size: min(1.35rem, calc(var(--category-icon-size, 36px) * 0.55));
    font-weight: 700;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category-icon-fallback {
    font-size: min(1rem, calc(var(--category-icon-size, 36px) * 0.42));
    opacity: 0.68;
  }
</style>
