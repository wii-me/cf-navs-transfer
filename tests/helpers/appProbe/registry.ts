// App 组件级测试（代码审查三轮第 18 项）用的子组件替身登记表。
// AppProbe.svelte 挂载时按 `pendingProbeName` 认领名字，把父组件传入的 props 对象（带 getter，
// 读取即得当前值）与每个 prop 的更新序列记在这里；测试据此断言 App 传给子组件的值与触发次数。

export interface ProbeEntry {
  name: string
  /** 父组件传入的 props 对象；属性是 getter，读取时得到当前值。 */
  props: Record<string, unknown>
  /** 每个 prop 每次（重新）传入子组件时的值序列（首次挂载也算一次）。 */
  updates: Record<string, unknown[]>
  mounts: number
  destroyed: number
}

export const probes: Record<string, ProbeEntry> = {}
export const probeLog: string[] = []
let pendingProbeName: string | null = null

export function claimProbeName(): string {
  const name = pendingProbeName ?? 'unknown'
  pendingProbeName = null
  return name
}

export function setPendingProbeName(name: string): void {
  pendingProbeName = name
}

export function resetProbes(): void {
  for (const key of Object.keys(probes)) delete probes[key]
  probeLog.length = 0
}

/** 当前挂载着的替身（挂载次数大于销毁次数）。 */
export function mounted(name: string): ProbeEntry | null {
  const entry = probes[name]
  return entry && entry.mounts > entry.destroyed ? entry : null
}
