import { writable, type Readable } from 'svelte/store'

export type LazyComponentModule<T> = {
  default: T
}

export type LazyComponentOptions<T> = {
  load: () => Promise<LazyComponentModule<T>>
  getCurrent: () => T | null
  setCurrent: (component: T) => void
}

export function createLazyComponentLoader<T>({
  load,
  getCurrent,
  setCurrent,
}: LazyComponentOptions<T>): () => Promise<void> {
  let pending: Promise<void> | null = null

  return function ensureLazyComponent(): Promise<void> {
    if (getCurrent()) return Promise.resolve()

    if (!pending) {
      pending = load()
        .then((module) => {
          setCurrent(module.default)
        })
        .finally(() => {
          pending = null
        })
    }

    return pending
  }
}

export type LazyComponentLoaders = Record<string, () => Promise<LazyComponentModule<unknown>>>

export type LazyComponentOf<L> = L extends () => Promise<LazyComponentModule<infer T>> ? T : never

export type LazyComponentRegistry<M extends LazyComponentLoaders> = {
  /** 每个组件一个独立 store：初值 null，加载成功后推送一次组件，之后不再变化。 */
  components: { [K in keyof M]: Readable<LazyComponentOf<M[K]> | null> }
  /** 确保组件已加载；语义同 createLazyComponentLoader（并发共享一个 promise、已加载不重载、失败可重试）。 */
  ensure(name: keyof M): Promise<void>
}

/**
 * 懒加载组件注册表（代码审查三轮第 11 项，从 App.svelte 抽出）。
 *
 * loaders 必须由调用方以 `() => import('./x.svelte')` 字面量传入：Vite 只对字面量路径做分包，
 * 这里只接收函数，不拼路径，保证 chunk 划分与抽出前一致。
 *
 * 每个组件一个 store，而不是一个汇总对象：App 里的 `$:` 只依赖自己关心的那个组件，
 * 别的组件加载完成不会让它重新执行（与原先 7 个独立 `let` 变量的依赖关系一致）。
 * 每个组件的加载仍由 createLazyComponentLoader 负责，缓存 / 并发 / 失败重试语义不变。
 */
export function createLazyComponentRegistry<M extends LazyComponentLoaders>(
  loaders: M,
): LazyComponentRegistry<M> {
  const components = {} as Record<keyof M, Readable<unknown>>
  const ensures = {} as Record<keyof M, () => Promise<void>>

  for (const name of Object.keys(loaders) as Array<keyof M>) {
    const store = writable<unknown>(null)
    let current: unknown = null
    components[name] = { subscribe: store.subscribe }
    ensures[name] = createLazyComponentLoader<unknown>({
      load: loaders[name],
      getCurrent: () => current,
      setCurrent: (component) => {
        current = component
        store.set(component)
      },
    })
  }

  return {
    components: components as LazyComponentRegistry<M>['components'],
    ensure: (name) => ensures[name](),
  }
}
