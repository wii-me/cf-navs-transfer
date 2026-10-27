<script lang="ts">
  // 第 8e 步测试替身：legacy 父组件向 Switch 传默认插槽内容（现有调用处都没传，但组件对外承诺支持）。
  import Switch from '../../../src/components/ui/Switch.svelte'

  export let checked = false
</script>

<Switch {checked} ariaLabel="带附加内容的开关"><span class="switch-extra">附加说明</span></Switch>
