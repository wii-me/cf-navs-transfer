// 让组件走原生加载 / 恢复路径的本地图标视图替身：始终 inactive。
// 原生路径（兜底图、重试预算、授权 key 变化）仍是本地库未命中或下载失败时的回退实现，
// 这些用例专门覆盖它；本地优先行为由 localIconView / iconLocalStore 单测覆盖。
export const emptyLocalIcon = { active: false, url: '', pending: false }
export function createLocalIconView(onChange: (value: typeof emptyLocalIcon) => void) {
  return { set: () => onChange(emptyLocalIcon), failed: () => undefined, destroy: () => undefined }
}
