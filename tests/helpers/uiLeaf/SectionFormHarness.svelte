<svelte:options runes />

<script lang="ts">
  // 第 8e 步测试替身：以 SettingsPanel 的方式 `bind:form` 渲染某个设置分区，
  // 记录分区经 syncForm / 预设选择写回的每一份新 form，用于观察子组件回调是否真的被父组件收到。
  // 第 8j 步 SettingsPanel 改为 runes（`form` 为深层 `$state`）后，替身随之改为 runes：分区内对
  // `form.x` 的字段绑定作用在 `$state` 代理上（不再报 binding_property_non_reactive）。
  // `onForm` 仍按 legacy `$: onForm(form)` 的对象粒度触发：整体替换或任一字段写入都会收到当前 form。
  // `$state` 代理不会改写传入的原对象；为让断言传入对象的用例（legacy 下字段经 `bind:` 就地写入）照常成立，
  // 每次变化后把当前值的快照写回传入对象。
  import { untrack, type Component, type ComponentType } from 'svelte'
  import type { SettingsFormModel } from '../../../src/lib/settingsForm'

  interface Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    section: Component<any> | ComponentType
    form: SettingsFormModel
    saving?: boolean
    onForm?: (form: SettingsFormModel) => void
  }

  let { section, form: initialForm, saving = false, onForm = () => {} }: Props = $props()

  let form: SettingsFormModel = $state(untrack(() => initialForm))

  $effect.pre(() => {
    const snapshot = $state.snapshot(form)
    const current = form
    untrack(() => {
      Object.assign(initialForm, snapshot)
      onForm(current)
    })
  })

  const Section = $derived(section as Component<{ form: SettingsFormModel; saving?: boolean }>)
</script>

<Section bind:form {saving} />
