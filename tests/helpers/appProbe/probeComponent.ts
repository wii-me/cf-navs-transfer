import type { Component } from 'svelte'
import AppProbe from './AppProbe.svelte'
import { setPendingProbeName } from './registry'

/** 生成一个名为 `name` 的替身组件：同步认领名字后交给 AppProbe 渲染。 */
export function probeComponent(name: string): Component<Record<string, unknown>> {
  const Probe = ((anchor: unknown, props: Record<string, unknown>) => {
    setPendingProbeName(name)
    return (AppProbe as unknown as (anchor: unknown, props: Record<string, unknown>) => unknown)(anchor, props)
  }) as unknown as Component<Record<string, unknown>>
  return Probe
}
