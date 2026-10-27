<script lang="ts">
  // 第 8d 步测试替身：以 legacy 父组件的方式 `bind:importSource`（与 admin/AdminTabContent 一致）。
  import BackupPanel from '../../../src/components/BackupPanel.svelte'
  import type { ImportSource } from '../../../src/lib/importData'

  export let importSource: ImportSource = 'cf-navs'
  export let onImportData: ((file: File, source: ImportSource, mode: 'replace' | 'merge') => void) | undefined = undefined
</script>

<BackupPanel bind:importSource isAuthenticated {onImportData} />
<output data-testid="bound-source">{importSource}</output>
