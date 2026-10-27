<script lang="ts">
  // 第 8g 步测试替身：以 Home / SettingsHomePreview（legacy）的方式 `bind:query` 渲染 HomeHeroSearch。
  import HomeHeroSearch from '../../../src/components/HomeHeroSearch.svelte'
  import type { PublicSettings } from '../../../shared/types'

  export let query = ''
  export let settings: PublicSettings | null = null
  export let pageTitle = '导航'
  export let preview = false
  export let themeOverride: 'light' | 'dark' | null = null
  export let onQuery: (query: string) => void = () => {}

  $: onQuery(query)
</script>

<HomeHeroSearch {pageTitle} siteTitleColor="#123456" siteTitleFontSize={28} {settings} {preview} {themeOverride} bind:query />
<button type="button" data-testid="harness-clear" on:click={() => (query = '')}>清空</button>
