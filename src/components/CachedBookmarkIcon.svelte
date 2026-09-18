<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    createBookmarkIconCacheKey,
    deleteCachedBookmarkIcon,
    fetchCachedBookmarkIconUrl,
    isDataImage,
    readCachedBookmarkIconDataUri,
    revokeLocalIconUrl,
  } from '../lib/localBookmarkIconCache'
  import { resolveCachedBookmarkIconDisplaySrc } from '../lib/cachedBookmarkIconDisplay'

  export let id: string | number
  export let icon = ''
  export let iconSource: string | null | undefined = null
  export let iconBlob = ''
  export let src = ''
  export let alt = ''
  export let fallback = ''
  export let className = ''
  export let style = ''

  let localUrl = ''
  let syncLocalUrl = ''
  let cachePending = false
  let failed = false
  let stateKey = ''
  const requestSequence = { current: 0 }

  $: trimmedIcon = icon.trim()
  $: trimmedIconBlob = iconBlob.trim()
  $: cacheKey = createBookmarkIconCacheKey({
    id,
    icon: trimmedIcon,
    iconSource,
  })
  $: syncLocalUrl = readCachedBookmarkIconDataUri(cacheKey) ?? ''
  $: shouldWaitForLocalCache = src.startsWith('/api/icon/') && !isDataImage(trimmedIconBlob)
  $: nextStateKey = `${cacheKey}:${trimmedIconBlob}:${src}`
  $: if (nextStateKey !== stateKey) {
    stateKey = nextStateKey
    failed = false
    resetLocalUrl()
    void loadCachedIcon(cacheKey, trimmedIconBlob, shouldWaitForLocalCache)
  }
  $: displaySrc = resolveCachedBookmarkIconDisplaySrc({
    syncLocalUrl,
    localUrl,
    failed,
    iconBlob: trimmedIconBlob,
    shouldWaitForLocalCache,
    cachePending,
    src,
  })

  function resetLocalUrl() {
    if (localUrl) {
      revokeLocalIconUrl(localUrl)
      localUrl = ''
    }
  }

  async function loadCachedIcon(key: string, dataUri: string, waitForLocalCache: boolean) {
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
    if (localUrl) {
      resetLocalUrl()
      return
    }
    failed = true
  }

  onDestroy(() => {
    requestSequence.current += 1
    resetLocalUrl()
  })
</script>

{#if displaySrc}
  <img
    class={className}
    style={style}
    src={displaySrc}
    alt={alt}
    loading="lazy"
    decoding="async"
    on:error={handleError}
  />
{/if}
{#if !displaySrc && fallback}
  {fallback}
{/if}
