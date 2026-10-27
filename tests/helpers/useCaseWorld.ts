// App 用例控制器差分测试的公共「世界」（代码审查三轮第 14 / 15 项）。
//
// 每个依赖替身都经 `call(name, args)` 进入：记录调用名、参数与调用时刻的完整状态快照，
// 再按场景脚本（每个依赖一条结果队列）返回值、抛错或挂起等待 `release`。
// 新控制器与逐字复刻的原 App 实现各自接到一个全新的世界上跑同一份脚本，比对日志即可。

export type Outcome = { value?: unknown; error?: unknown; defer?: string; effect?: (w: UseCaseWorld) => void }

export type Plan = Record<string, Outcome[]>

export interface LogEntry { call: string; args: unknown[]; state: unknown }

export async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

export class UseCaseWorld {
  log: LogEntry[] = []
  gates = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private queues = new Map<string, Outcome[]>()

  constructor(
    plan: Plan,
    private readonly defaults: Record<string, unknown>,
    public snapshot: () => unknown = () => null,
  ) {
    for (const [name, outcomes] of Object.entries(plan)) this.queues.set(name, [...outcomes])
  }

  record(call: string, ...args: unknown[]): void {
    this.log.push({ call, args: structuredClone(args), state: structuredClone(this.snapshot()) })
  }

  /** 记录一次依赖调用并按脚本兑现；没有脚本时以 defaults[name]（缺省 undefined）兑现。 */
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    this.record(name, ...args)
    const queue = this.queues.get(name)
    const outcome: Outcome = queue?.shift() ?? { value: this.defaults[name] }
    const settle = (o: Outcome): Promise<T> => {
      o.effect?.(this)
      return ('error' in o ? Promise.reject(o.error) : Promise.resolve(o.value)) as Promise<T>
    }
    if (outcome.defer) {
      const gate = outcome.defer
      return new Promise((resolve, reject) => {
        this.gates.set(gate, { resolve, reject })
      }).then((o) => settle(o as Outcome))
    }
    return settle(outcome)
  }

  /** 同步依赖：记录调用并返回脚本值（不支持 defer）。 */
  callSync<T = unknown>(name: string, ...args: unknown[]): T {
    this.record(name, ...args)
    const outcome: Outcome = this.queues.get(name)?.shift() ?? { value: this.defaults[name] }
    outcome.effect?.(this)
    if ('error' in outcome) throw outcome.error
    return outcome.value as T
  }

  /** 放行一个挂起中的调用，并让后续微任务全部跑完。 */
  async release(gate: string, outcome: Outcome = {}): Promise<void> {
    const entry = this.gates.get(gate)
    if (!entry) throw new Error(`no gate ${gate}`)
    this.gates.delete(gate)
    entry.resolve(outcome)
    await flush()
  }
}

export function track(settled: string[], label: string, p: Promise<unknown>): Promise<void> {
  return p.then(
    () => { settled.push(`${label}:ok`) },
    (e) => { settled.push(`${label}:err:${e instanceof Error ? e.message : String(e)}`) },
  )
}
