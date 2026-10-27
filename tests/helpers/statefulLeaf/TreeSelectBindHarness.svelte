<script lang="ts">
  // 第 8d 步测试替身：以 legacy 父组件的方式 `bind:value`（与 BookmarkContextMenu / BookmarkBaseFields 等调用处一致）。
  import CategoryTreeSelect from '../../../src/components/CategoryTreeSelect.svelte'
  import type { CategoryTreeOption } from '../../../src/lib/categorySelect'

  export let value: string | number | null | undefined = undefined
  export let items: CategoryTreeOption[] = []
  export let rootOptionLabel = ''
  export let inlineMenu = false
  export let onLayoutChange: (() => void) | undefined = undefined
</script>

<CategoryTreeSelect bind:value {items} {rootOptionLabel} {inlineMenu} {onLayoutChange} ariaLabel="选择分类" />
<output data-testid="bound-value">{value === null ? 'null' : String(value)}</output>
<button type="button" data-testid="outside">outside</button>
