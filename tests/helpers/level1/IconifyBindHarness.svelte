<script lang="ts">
  // 第 8g 步测试替身：以 BookmarkEditModal / CategoryEditModal（legacy）的方式 `bind:iconifyName`。
  import IconifySelector from '../../../src/components/IconifySelector.svelte'
  import type { IconifyCandidate } from '../../../shared/types'

  export let iconifyName = ''
  export let iconifyPreviewUrl = ''
  export let iconifySelected = false
  export let iconifyUseConfirmed = false
  export let confirmedIconifyName = ''
  export let iconifySearchCandidates: IconifyCandidate[] = []
  export let iconifySearchLoading = false
  export let iconifySearchError = ''
  export let candidateError = ''
  export let loading = false
  export let onOpenLibrary: (() => void) | undefined = undefined
  export let onSelectIcon: (() => void) | undefined = undefined
  export let onSelectCandidate: ((candidate: IconifyCandidate) => void) | undefined = undefined
  export let onName: (name: string) => void = () => {}

  $: onName(iconifyName)
</script>

<IconifySelector
  bind:iconifyName
  {iconifyPreviewUrl}
  {iconifySelected}
  {iconifyUseConfirmed}
  {confirmedIconifyName}
  {iconifySearchCandidates}
  {iconifySearchLoading}
  {iconifySearchError}
  {candidateError}
  {loading}
  {onOpenLibrary}
  {onSelectIcon}
  {onSelectCandidate}
/>
<button type="button" data-testid="harness-set-name" on:click={() => (iconifyName = 'mdi:star')}>设置</button>
