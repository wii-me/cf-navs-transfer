// 分类/书签通用批量列写入：按 id 映射写目标列，受 D1 参数上限约束分块提交

import { commitMutation, type MutationReceipt } from './mutation'

// D1 单条预处理语句最多绑定 100 个参数；本 UPDATE 每个 id 用 3 个参数
// （CASE 的 WHEN ? THEN ? 两个 + WHERE IN (?) 一个），故每批最多 33 个 id，取 30 留余量。
export const SORT_UPDATE_CHUNK_SIZE = 30

export type SortTable = 'categories' | 'bookmarks'

// 只允许按 id 定位改写的整数列，防止列名拼接成为注入面。
export type RowUpdateColumn = 'sort' | 'category_id'

export type RowUpdateEntry = readonly [id: number, value: number]

export type SortUpdateChunk = {
  sql: string
  params: number[]
}

export function buildColumnUpdateChunks(
  table: SortTable,
  column: RowUpdateColumn,
  entries: readonly RowUpdateEntry[],
): SortUpdateChunk[] {
  const chunks: SortUpdateChunk[] = []

  for (let start = 0; start < entries.length; start += SORT_UPDATE_CHUNK_SIZE) {
    const chunk = entries.slice(start, start + SORT_UPDATE_CHUNK_SIZE)
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ')
    const where = chunk.map(() => '?').join(', ')
    const params: number[] = []

    for (const [id, value] of chunk) {
      params.push(id, value)
    }
    for (const [id] of chunk) {
      params.push(id)
    }

    chunks.push({
      sql: `UPDATE ${table} SET ${column} = CASE id ${cases} ELSE ${column} END WHERE id IN (${where})`,
      params,
    })
  }

  return chunks
}

export function buildSortUpdateChunks(table: SortTable, ids: number[]): SortUpdateChunk[] {
  return buildColumnUpdateChunks(table, 'sort', ids.map((id, index) => [id, index] as const))
}

export async function runUpdateChunks(
  db: D1Database,
  chunks: SortUpdateChunk[],
  receipt?: MutationReceipt,
): Promise<void> {
  if (chunks.length === 0) return

  const stmts = chunks.map((chunk) => db.prepare(chunk.sql).bind(...chunk.params))
  // D1 batch 在一个调用内原子执行；不能拆成多个 batch，否则跨分类整理
  // 可能只提交前半部分 category_id/sort 更新。data_version 提升作为同一 batch
  // 的最后一条语句一起提交。
  await commitMutation(db, stmts, receipt)
}

export async function sortRowsByIds(
  db: D1Database,
  table: SortTable,
  ids: number[],
  receipt?: MutationReceipt,
): Promise<void> {
  if (ids.length === 0) return
  await runUpdateChunks(db, buildSortUpdateChunks(table, ids), receipt)
}
