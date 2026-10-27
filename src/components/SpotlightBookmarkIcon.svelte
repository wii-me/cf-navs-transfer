<svelte:options runes />

<script lang="ts">
  import { createLocalIconView, emptyLocalIcon } from '../lib/localIconView'
  import { applyIconDisplayOverride, bookmarkIconDisplay } from '../lib/iconDisplayStore'
  // 本地图标视图每次发布新对象；不做深层代理。
  let localImage = $state.raw(emptyLocalIcon)
  const localView = createLocalIconView(value => { localImage = value })
  import { onDestroy, untrack } from 'svelte'
  import type { PublicBookmark } from '../../shared/types'
  import {
    deriveBookmarkCardIconBase,
    deriveBookmarkCardIconUrl,
  } from '../lib/bookmarkCardIconState'
  import { createIconRetry } from '../lib/iconRetry'
  import { buildIconStyle } from '../lib/bookmarkIconDisplay'
  import {
    fetchBookmarkIcon,
    fetchCachedBookmarkIconUrl,
    readCachedBookmarkIconDataUri,
    revokeLocalIconUrl,
  } from '../lib/localBookmarkIconCache'
  import BookmarkIcon from './BookmarkIcon.svelte'

  const ICON_SIZE = 30

  interface Props {
    bookmark: PublicBookmark
    /** 私密对象及其私密分类树下的书签需要授权 key；公开对象传空串以保留共享缓存。 */
    iconAccessKey?: string
    reuseCompletedObject?: boolean
  }

  let { bookmark, iconAccessKey = '', reuseCompletedObject = false }: Props = $props()

  let cachedIconFailed = $state(false)
  let fallbackFailed = $state(false)
  let localCachedIconUrl = $state('')
  // 只在处理器与加载函数里读写，不进模板。
  let localIconReady = false
  const iconRetry = createIconRetry(() => {
    if (iconBaseState.proxiedHttpIconUrl) {
      void loadLocalCachedIcon(iconBaseState.localCacheKey, false, iconBaseState.proxiedHttpIconUrl)
    }
  })
  let localCachePending = $state(false)
  // 只在下面的副作用里比较，不进模板。
  let iconStateKey = ''
  const localCacheRequest = { current: 0 }

  // watch 对同一 id 返回同一个 store，`$iconDisplayOverride` 不会反复重订阅。
  const iconDisplayOverride = $derived(bookmarkIconDisplay.watch(bookmark.id))
  const iconBookmark = $derived(applyIconDisplayOverride(bookmark, $iconDisplayOverride))
  // 原拓扑顺序：iconBaseState 先于依赖它的 localView.set 计算。
  const iconBaseState = $derived(deriveBookmarkCardIconBase({
    bookmark: iconBookmark,
    iconInView: true,
    shouldWaitForLocalIconCache: true,
    iconAccessKey,
  }))
  // 与原 `$:` 一样先于 DOM 更新、在状态键判断之前执行；set 内部按签名去重，只在入参依赖变化时调用。
  $effect.pre(() => {
    const input = { ...iconBookmark, visible: true, online_url: iconBaseState.proxiedHttpIconUrl }
    untrack(() => localView.set(input))
  })
  const iconText = $derived(iconBaseState.iconText)
  const localCacheKey = $derived(iconBaseState.localCacheKey)
  const syncLocalCachedIconUrl = $derived(readCachedBookmarkIconDataUri(localCacheKey) ?? '')
  const iconUrlState = $derived(deriveBookmarkCardIconUrl({
    bookmark: iconBookmark,
    baseState: iconBaseState,
    cachedIconFailed,
    fallbackFailed,
    syncLocalCachedIconUrl,
    localCachedIconUrl,
    localCachePending,
  }))
  const iconUrl = $derived(localImage.active ? localImage.url : iconUrlState.hasRenderableIcon ? iconUrlState.iconUrl : '')
  const iconStyle = $derived(buildIconStyle(ICON_SIZE, {
    customBackground: bookmark.icon_background_color ?? '',
  }))
  const nextStateKey = $derived(iconBaseState.nextIconStateKey + ':' + localImage.active)
  // 状态键变化时复位并重新加载；原语句的语法依赖是 nextStateKey 与 iconBaseState / localImage
  // （三者都已含在键里或随键变化），被调用函数里读写的 localCachedIconUrl 等不作为依赖。
  $effect.pre(() => {
    const key = nextStateKey
    const baseState = iconBaseState
    const localActive = localImage.active
    untrack(() => {
      if (key === iconStateKey) return
      iconStateKey = key
      cachedIconFailed = false
      fallbackFailed = false
      localIconReady = false
      iconRetry.reset()
      resetLocalCachedIconUrl()
      if (baseState.shouldReadLocalIconCache && !localActive) {
        void loadLocalCachedIcon(
          baseState.localCacheKey,
          baseState.shouldWaitForLocalIconCache,
          baseState.shouldUseIconProxy ? baseState.proxiedHttpIconUrl : '',
        )
      } else {
        localCacheRequest.current += 1
        localCachePending = false
      }
    })
  })

  function resetLocalCachedIconUrl(): void {
    if (!localCachedIconUrl) return
    revokeLocalIconUrl(localCachedIconUrl)
    localCachedIconUrl = ''
  }

  async function loadLocalCachedIcon(cacheKey: string, waitForLocalCache: boolean, remoteUrl: string): Promise<void> {
    if (localImage.active) return
    if (waitForLocalCache) localCachePending = true

    const result = await fetchCachedBookmarkIconUrl(cacheKey, localCacheRequest)
    if (result.stale) return
    const requestSequence = localCacheRequest.current
    if (result.url) {
      localIconReady = true
      resetLocalCachedIconUrl()
      localCachedIconUrl = result.url
      localCachePending = false
      return
    }

    if (remoteUrl) {
      const remote = await fetchBookmarkIcon(cacheKey, remoteUrl, {
        reuseCompletedObject: reuseCompletedObject || iconBaseState.hasProjectedImageIcon,
      })
      if (requestSequence !== localCacheRequest.current) {
        if (remote.url) revokeLocalIconUrl(remote.url)
        return
      }
      localIconReady = remote.status === 'ready'
      if (remote.url) {
        resetLocalCachedIconUrl()
        localCachedIconUrl = remote.url
        cachedIconFailed = false
        fallbackFailed = false
      } else if (!localCachedIconUrl) {
        cachedIconFailed = true
        fallbackFailed = true
      }
      if (remote.status === 'retryable') iconRetry.failed()
      else if (remote.status === 'unavailable') iconRetry.reset()
    }

    localCachePending = false
  }

  function handleIconError(): void {
    if (localImage.active) { localView.failed(); return }
    if (localCachedIconUrl) {
      resetLocalCachedIconUrl()
      localIconReady = false
      if (iconBaseState.proxiedHttpIconUrl) {
        cachedIconFailed = true
        fallbackFailed = true
        iconRetry.failed()
      }
      return
    }

    // An uncached HTTP <img> never went through fetchBookmarkIcon. Its error must
    // enter the same recovery path; otherwise only opening the editor can fetch
    // the icon server-side and reset the failed card (Issue #28).
    if (!iconBaseState.hasEmbeddedIcon && iconBaseState.proxiedHttpIconUrl) {
      cachedIconFailed = true
      fallbackFailed = true
      iconRetry.failed()
      return
    }

    if (!cachedIconFailed && (iconBaseState.hasEmbeddedIcon || iconBaseState.shouldUseIconProxy)) {
      cachedIconFailed = true
      if (iconBaseState.shouldUseIconProxy) iconRetry.failed()
      return
    }

    fallbackFailed = true
  }

  function handleIconLoad(): void {
    if (localIconReady) iconRetry.reset()
    localCachePending = false
    fallbackFailed = false
  }

  onDestroy(() => {
    localView.destroy()
    iconRetry.dispose()
    localCacheRequest.current += 1
    resetLocalCachedIconUrl()
  })
</script>

<span class="spotlight-option-icon" aria-hidden="true">
  <BookmarkIcon
    title={bookmark.title}
    {iconUrl}
    {iconText}
    size={ICON_SIZE}
    {iconStyle}
    hasCustomBackground={Boolean(bookmark.icon_background_color)}
    variant="compact"
    onError={handleIconError}
    onLoad={handleIconLoad}
  />
</span>

<style>
  .spotlight-option-icon {
    display: block;
    flex: 0 0 30px;
    width: 30px;
    height: 30px;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }

  .spotlight-option-icon :global(.bookmark-icon) {
    border-radius: var(--radius-sm);
  }
</style>
