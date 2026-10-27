<svelte:options runes />
<script lang="ts">
  // AdminTabContent 设置页懒加载组件的替身：把收到的 props 写进 data-* 供断言。
  interface Props {
    value?: { site_title?: string } | null
    loading?: boolean
    saving?: boolean
    error?: string
    onSubmit?: (payload: unknown) => void
  }
  let { value = null, loading = false, saving = false, error = '', onSubmit }: Props = $props()
</script>

<button
  type="button"
  data-testid="settings-probe"
  data-loading={String(loading)}
  data-saving={String(saving)}
  data-error={error}
  data-title={value?.site_title ?? ''}
  onclick={() => onSubmit?.({ ok: true })}
>probe</button>
