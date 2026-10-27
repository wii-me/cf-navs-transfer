// 测试辅助（APP_SPLIT_PLAN 第 8j 步）：以 `$state` 深层代理包装普通对象，
// 模拟 runes 父组件（SettingsPanel 的 `form`）传给设置分区的表单。直接挂载分区的用例用它代替普通对象，
// 使分区内对字段的 `bind:` 与生产环境一样作用在响应式代理上（否则开发构建报 binding_property_non_reactive）。
export function reactiveState<T extends object>(value: T): T {
  const state = $state(value)
  return state
}
