<svelte:options runes />

<script lang="ts">
  import { observeIconVisibility } from '../lib/iconVisibility'
  import { createLocalIconView, emptyLocalIcon } from '../lib/localIconView'
  import { applyIconDisplayOverride, bookmarkIconDisplay } from '../lib/iconDisplayStore'
  // 本地图标视图每次发布新对象；不做深层代理。
  let localImage = $state.raw(emptyLocalIcon)
  const localView = createLocalIconView(value => { localImage = value })
  let anchor: HTMLSpanElement
  let inView = $state(false)
  let stopVisibility: (() => void) | undefined
  import { onDestroy, onMount, untrack } from 'svelte'
  import {
    createBookmarkIconCacheKey,
    deleteCachedBookmarkIcon,
    fetchCachedBookmarkIconUrl,
    isDataImage,
    readCachedBookmarkIconDataUri,
    revokeLocalIconUrl,
  } from '../lib/localBookmarkIconCache'
  import { resolveCachedBookmarkIconDisplaySrc } from '../lib/cachedBookmarkIconDisplay'

  interface Props {
    id: string | number
    icon?: string
    iconSource?: string | null
    iconCached?: boolean | number | null
    iconRevision?: string | null
    iconWriteEpoch?: number
    iconDisplay?: 'image' | 'text' | 'empty'
    iconBlob?: string
    src?: string
    alt?: string
    fallback?: string
    className?: string
    style?: string
  }

  let {
    id,
    icon = '',
    iconSource = null,
    iconCached = undefined,
    iconRevision = undefined,
    iconWriteEpoch = undefined,
    iconDisplay = undefined,
    iconBlob = '',
    src = '',
    alt = '',
    fallback = '',
    className = '',
    style = '',
  }: Props = $props()

  let localUrl = $state('')
  let cachePending = $state(false)
  let failed = $state(false)
  // 只在下面的副作用里比较，不进模板。
  let stateKey = ''
  const requestSequence = { current: 0 }

  // 图标显示状态来自独立的按 id 订阅表，与结构化书签数据分离。
  // watch 对同一 id 返回同一个 store，`$iconDisplayOverride` 不会反复重订阅。
  const iconDisplayOverride = $derived(bookmarkIconDisplay.watch(Number(id)))
  const iconRow = $derived(applyIconDisplayOverride({ icon: icon.trim(), icon_blob: iconBlob.trim(), icon_revision: iconRevision, icon_cached: iconCached, icon_write_epoch: iconWriteEpoch, icon_display: iconDisplay }, $iconDisplayOverride))
  const trimmedIcon = $derived(iconRow.icon ?? '')
  const trimmedIconBlob = $derived(iconRow.icon_blob ?? '')
  // 与原 `$:` 一样先于 DOM 更新、在状态键判断之前执行；set 内部按签名去重，只在入参依赖变化时调用。
  $effect.pre(() => {
    const input = { ...iconRow, id: Number(id), icon: trimmedIcon, icon_blob: trimmedIconBlob, visible: inView, online_url: src }
    untrack(() => localView.set(input))
  })
  const cacheKey = $derived(createBookmarkIconCacheKey({
    id,
    icon: trimmedIcon,
    iconSource,
  }))
  const syncLocalUrl = $derived(readCachedBookmarkIconDataUri(cacheKey) ?? '')
  const shouldWaitForLocalCache = $derived(src.startsWith('/api/icon/') && !isDataImage(trimmedIconBlob))
  const nextStateKey = $derived(`${cacheKey}:${trimmedIconBlob}:${src}:${localImage.active}`)
  // 状态键变化时复位并重新加载；只依赖状态键（其余量都已含在键里），
  // 被调用函数里读写的 localUrl / cachePending / localImage 不作为依赖（与原语句的语法依赖一致）。
  $effect.pre(() => {
    const key = nextStateKey
    const keyForCache = cacheKey
    const blob = trimmedIconBlob
    const waitForLocalCache = shouldWaitForLocalCache
    untrack(() => {
      if (key === stateKey) return
      stateKey = key
      failed = false
      resetLocalUrl()
      void loadCachedIcon(keyForCache, blob, waitForLocalCache)
    })
  })
  const legacyDisplaySrc = $derived(resolveCachedBookmarkIconDisplaySrc({
    syncLocalUrl,
    localUrl,
    failed,
    iconBlob: trimmedIconBlob,
    shouldWaitForLocalCache,
    cachePending,
    src,
  }))

  const displaySrc = $derived(localImage.active ? localImage.url : legacyDisplaySrc)

  onMount(() => { stopVisibility = observeIconVisibility(anchor, () => { inView = true }) })

  function resetLocalUrl() {
    if (localUrl) {
      revokeLocalIconUrl(localUrl)
      localUrl = ''
    }
  }

  async function loadCachedIcon(key: string, dataUri: string, waitForLocalCache: boolean) {
    if (localImage.active) return
    if (isDataImage(dataUri)) {
      requestSequence.current += 1
      cachePending = false
      await deleteCachedBookmarkIcon(key)
      return
    }

    if (waitForLocalCache) {
      cachePending = true
    }

    const result = await fetchCachedBookmarkIconUrl(key, requestSequence)
    if (result.stale) return
    if (result.url) {
      resetLocalUrl()
      localUrl = result.url
      cachePending = false
      return
    }

    cachePending = false
  }

  function handleError() {
    if (localImage.active) { localView.failed(); return }
    if (localUrl) {
      resetLocalUrl()
      return
    }
    failed = true
  }

  onDestroy(() => {
    localView.destroy()
    stopVisibility?.()
    requestSequence.current += 1
    resetLocalUrl()
  })
</script>

<span class="cached-icon-frame" bind:this={anchor}>
{#if displaySrc}
  <img
    class={className}
    style={style}
    src={displaySrc}
    alt={alt}
    loading="lazy"
    decoding="async"
    onerror={handleError}
  />
{/if}
{#if !displaySrc && fallback}
  {fallback}
{/if}

</span>
<style>.cached-icon-frame { display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 100%; }</style>
