// 书签图标显示状态（可信设备图标描述符回写）与结构化书签数据分离。
//
// 以前每加载完一个可信图标就重建整个 bookmarks 数组（adminStore + publicStore），
// 首页 homeData 的排序 / 分组 / 搜索索引 memo 全部失效，App 的全局 CSS 也随 publicData
// 变化整段重写；N 个图标就是 N 次 O(N) 重建。现在描述符只写进这个按对象 id 索引的小表，
// 由渲染图标的组件按 id 订阅（每个 id 一个独立的 store，更新只通知该 id 的订阅者），
// 首页派生数据只依赖结构字段的数组身份，不再因图标而重算。持久化快照时再把覆盖合并回去。

import type { Readable } from 'svelte/store'

export type IconDisplayKind = 'image' | 'text' | 'empty'

export interface IconDisplayOverride {
  dataset_epoch: string
  icon_revision: string | null
  icon_write_epoch: number
  icon_display: IconDisplayKind
}

export interface IconDisplayRow {
  icon?: string | null
  icon_blob?: string | null
  icon_revision?: string | null
  icon_write_epoch?: number
  icon_display?: IconDisplayKind
  icon_cached?: boolean | number | null
}

/**
 * 把覆盖合并到一行上；不适用时原样返回同一个对象（保持身份，便于 memo）。
 * 与原数组补丁同一口径：行上的 write_epoch 更新（服务端已有更新的写入）时覆盖失效。
 */
export function applyIconDisplayOverride<T extends IconDisplayRow>(row: T, override: IconDisplayOverride | undefined): T {
  if (!override) return row
  if ((row.icon_write_epoch ?? 0) > override.icon_write_epoch) return row
  const display = override.icon_display
  if (row.icon_revision === override.icon_revision && row.icon_write_epoch === override.icon_write_epoch && row.icon_display === display) return row
  return {
    ...row,
    icon_revision: override.icon_revision,
    icon_write_epoch: override.icon_write_epoch,
    icon_display: display,
    icon_cached: display === 'image',
    ...(display === 'empty' ? { icon: null, icon_blob: null, icon_cached: false } : {}),
  }
}

type Listener = (value: IconDisplayOverride | undefined) => void

export function createIconDisplayStore() {
  const values = new Map<number, IconDisplayOverride>()
  const listeners = new Map<number, Set<Listener>>()
  const stores = new Map<number, Readable<IconDisplayOverride | undefined>>()

  function notify(id: number): void {
    const value = values.get(id)
    for (const listener of [...(listeners.get(id) ?? [])]) listener(value)
  }

  return {
    get(id: number): IconDisplayOverride | undefined {
      return values.get(id)
    },
    set(id: number, value: IconDisplayOverride): void {
      const current = values.get(id)
      if (current && current.dataset_epoch === value.dataset_epoch && current.icon_revision === value.icon_revision &&
        current.icon_write_epoch === value.icon_write_epoch && current.icon_display === value.icon_display) return
      values.set(id, value)
      notify(id)
    },
    /** 单个 id 的只读 store；同一 id 返回同一对象，组件里 `$store` 不会反复重订阅。 */
    watch(id: number): Readable<IconDisplayOverride | undefined> {
      let store = stores.get(id)
      if (!store) {
        store = {
          subscribe(run: Listener) {
            let set = listeners.get(id)
            if (!set) listeners.set(id, set = new Set())
            set.add(run)
            run(values.get(id))
            return () => {
              const current = listeners.get(id)
              current?.delete(run)
              if (current && current.size === 0) listeners.delete(id)
            }
          },
        }
        stores.set(id, store)
      }
      return store
    },
    /** 删除不再适用的覆盖（换数据集、对象被删、服务端已有更新的写入）。 */
    prune(keep: (id: number, value: IconDisplayOverride) => boolean): void {
      for (const [id, value] of [...values]) {
        if (keep(id, value)) continue
        values.delete(id)
        notify(id)
      }
    },
    clear(): void {
      const ids = [...values.keys()]
      values.clear()
      for (const id of ids) notify(id)
    },
    get size(): number {
      return values.size
    },
    /** 合并覆盖后的数组；没有任何覆盖适用时返回原数组（身份不变）。 */
    applyTo<T extends IconDisplayRow & { id: number }>(rows: T[]): T[] {
      if (values.size === 0) return rows
      let changed = false
      const next = rows.map((row) => {
        const merged = applyIconDisplayOverride(row, values.get(row.id))
        if (merged !== row) changed = true
        return merged
      })
      return changed ? next : rows
    },
  }
}

export type IconDisplayStore = ReturnType<typeof createIconDisplayStore>

/** 书签图标显示覆盖（分类图标数量少，仍走原数组补丁路径）。 */
export const bookmarkIconDisplay = createIconDisplayStore()
