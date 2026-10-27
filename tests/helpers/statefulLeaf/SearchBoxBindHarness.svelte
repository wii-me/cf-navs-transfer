<script lang="ts">
  // 第 8d 步测试替身：以 legacy 父组件的方式 `bind:query`（与 HomeHeroSearch 一致）。
  import SearchBox from '../../../src/components/SearchBox.svelte'
  import type { SearchEngineSetting } from '../../../shared/types'

  export let query = ''
  export let searchEngine: SearchEngineSetting | null = null
</script>

<SearchBox bind:query {searchEngine} />
<output data-testid="bound-query">{query}</output>
<button type="button" data-testid="set-query" on:click={() => { query = 'from parent' }}>set</button>
