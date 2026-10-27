// 数据变更统一提交：业务写入与 data_version 提升放进同一个 D1 batch（一个事务）。
//
// 之前每个写路由都是「先写业务，再单独 touchDataVersion()」两次往返：两步之间
// 失败会留下「数据已变、版本未变」的状态，其它设备的快照校验永远发现不了；并发读
// 也可能读到「新数据 + 旧版本」再被缓存。这里把版本行写入作为 batch 的一条语句，
// 和业务写入原子提交，并把新版本号带回给路由，用于写响应的 `data_version` 字段。

import { DATA_VERSION_KEY } from './sql'
import { createDataVersion } from './settingsHelpers'

/** 路由侧收据：提交成功且确实提升了版本时填入新版本号，否则保持 null。 */
export interface MutationReceipt {
  data_version: string | null
}

export function createMutationReceipt(): MutationReceipt {
  return { data_version: null }
}

/**
 * 版本提升的守卫条件：一段 SQL 布尔表达式及其参数，在同一事务中求值，
 * 为假时本条版本写入不生效。用于「业务写入可能命中 0 行」的场景，避免
 * 404 / 集合过期时白白提升版本、让所有客户端多拉一次全量数据。
 */
export interface DataVersionGuard {
  sql: string
  params: unknown[]
}

// INSERT OR REPLACE 与 schema.sql 里图标触发器的写法一致；value 存 JSON 字符串。
export function dataVersionStatement(
  db: D1Database,
  version: string,
  guard?: DataVersionGuard,
): D1PreparedStatement {
  if (!guard) {
    return db
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${DATA_VERSION_KEY}', json_quote(?))`)
      .bind(version)
  }
  return db
    .prepare(`INSERT OR REPLACE INTO settings (key, value) SELECT '${DATA_VERSION_KEY}', json_quote(?) WHERE ${guard.sql}`)
    .bind(version, ...guard.params)
}

type Step = { kind: 'write'; statement: D1PreparedStatement } | { kind: 'bump'; statement: D1PreparedStatement; guarded: boolean }

/**
 * 一次数据变更。`add` 追加业务语句，`bump` 在当前位置插入一条（可带守卫的）
 * 版本写入；同一次变更内所有版本写入使用同一个版本值，因此多条守卫写入是幂等的，
 * 任意一条命中即视为版本已提升。未显式调用 `bump` 时，`commit` 在末尾追加一条
 * 无条件版本写入。
 *
 * 顺序约定：会触发 `UPDATE OF icon...` 触发器的语句之后必须再写一次版本（默认的
 * 末尾写入即可），否则触发器写入的随机版本会覆盖本次版本，导致响应里的
 * `data_version` 与库中不一致。纯 DELETE 不触发图标触发器，可把守卫写入放在前面，
 * 用「删除前记录是否存在」作为守卫。
 */
export class Mutation {
  readonly version = createDataVersion()
  private readonly steps: Step[] = []

  constructor(private readonly db: D1Database) {}

  add(...statements: D1PreparedStatement[]): this {
    for (const statement of statements) this.steps.push({ kind: 'write', statement })
    return this
  }

  get hasWrites(): boolean {
    return this.steps.some((step) => step.kind === 'write')
  }

  bump(guard?: DataVersionGuard): this {
    this.steps.push({ kind: 'bump', statement: dataVersionStatement(this.db, this.version, guard), guarded: Boolean(guard) })
    return this
  }

  /** 原子提交；返回业务语句（不含版本写入）的结果，顺序与 `add` 一致。 */
  async commit(receipt?: MutationReceipt): Promise<D1Result[]> {
    if (!this.steps.some((step) => step.kind === 'bump')) this.bump()
    const results = await this.db.batch(this.steps.map((step) => step.statement))
    const writes: D1Result[] = []
    let bumped = false
    this.steps.forEach((step, index) => {
      const result = results[index]
      if (step.kind === 'write') {
        writes.push(result)
      } else if (!step.guarded || (result?.meta?.changes ?? 0) > 0) {
        bumped = true
      }
    })
    if (receipt && bumped) receipt.data_version = this.version
    return writes
  }
}

/** 最常见形态：业务语句 + 末尾一条无条件版本写入，一次 batch 提交。 */
export async function commitMutation(
  db: D1Database,
  statements: D1PreparedStatement[],
  receipt?: MutationReceipt,
): Promise<D1Result[]> {
  return await new Mutation(db).add(...statements).commit(receipt)
}

// D1 单条语句最多 100 个绑定参数；守卫与分块 DELETE 统一按此上限留余量。
export const ID_CHUNK_SIZE = 90

export function chunkIds(ids: readonly number[], size = ID_CHUNK_SIZE): number[][] {
  const chunks: number[][] = []
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size))
  return chunks
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
