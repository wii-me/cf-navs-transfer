<script lang="ts">
  // 第 8g 步测试替身：以 BookmarkEditModal（legacy）的方式 `bind:` BookmarkBaseFields 的 7 个字段，
  // 每次写回后把当前值整体上报，用于观察子组件迁移后双向绑定是否仍回到父组件。
  import BookmarkBaseFields from '../../../src/components/BookmarkBaseFields.svelte'
  import type { BookmarkFormValue } from '../../../src/lib/adminTypes'
  import type { CategoryTreeOption } from '../../../src/lib/categorySelect'

  export let form: Pick<BookmarkFormValue, 'category_id' | 'title' | 'url' | 'open_method' | 'is_private' | 'description' | 'description_mode'>
  export let categories: CategoryTreeOption[] = []
  export let loading = false
  export let titleLoading = false
  export let onUrlBlur: (() => void) | undefined = undefined
  export let onForm: (form: Record<string, unknown>) => void = () => {}

  $: onForm({ ...form })
</script>

<BookmarkBaseFields
  bind:categoryId={form.category_id}
  bind:title={form.title}
  bind:url={form.url}
  bind:openMethod={form.open_method}
  bind:isPrivate={form.is_private}
  bind:description={form.description}
  bind:descriptionMode={form.description_mode}
  {categories}
  {loading}
  {titleLoading}
  {onUrlBlur}
/>
