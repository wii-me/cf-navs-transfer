export function normalizeSortIds(ids: Array<string | number>): number[] {
  return ids.map((id) => Number(id))
}

export function queueSortSave(previousSave: Promise<void>, save: () => Promise<void>): Promise<void> {
  return previousSave
    // 有意吞掉：上一次保存的失败已由它自己的 runOptimisticSort 调用方报告并回滚，
    // 这里只负责排队，不能让旧失败阻断（或重复报告给）本次保存。
    .catch(() => undefined)
    .then(save)
}

export function isLatestSortRequest(requestSeq: number, latestSeq: number): boolean {
  return requestSeq === latestSeq
}

export interface OptimisticSortState {
  savePromise: Promise<void>
  requestSeq: number
}

export interface OptimisticSortOptions {
  applyLocalSort: (ids: number[]) => Promise<void>
  saveRemoteSort: (ids: number[]) => Promise<unknown>
  persist: () => Promise<void>
  onSuccess?: () => Promise<void>
  restoreOnError: () => Promise<void>
  onError: (error: unknown) => void
}

export function createOptimisticSortState(): OptimisticSortState {
  return {
    savePromise: Promise.resolve(),
    requestSeq: 0,
  }
}

export async function runOptimisticSort(
  state: OptimisticSortState,
  ids: Array<string | number>,
  options: OptimisticSortOptions,
): Promise<void> {
  const sortedIds = normalizeSortIds(ids)
  const requestSeq = ++state.requestSeq
  await options.applyLocalSort(sortedIds)

  const savePromise = queueSortSave(state.savePromise, async () => {
    await options.saveRemoteSort(sortedIds)
  })
  state.savePromise = savePromise

  try {
    await savePromise
    if (isLatestSortRequest(requestSeq, state.requestSeq)) {
      await options.persist()
      await options.onSuccess?.()
    }
  } catch (error) {
    if (isLatestSortRequest(requestSeq, state.requestSeq)) {
      options.onError(error)
      // 保存失败已经通过 onError 报告；回滚本身再失败时不能覆盖那条错误，
      // 但也不能静默——本地顺序可能停在乐观状态，留下诊断线索。
      await options.restoreOnError().catch((restoreError) => {
        console.warn('[CF-Navs] failed to restore sort order after save error', restoreError)
      })
    }
  }
}
