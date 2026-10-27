import type { IconDataMetadata } from '../../shared/iconDescriptor'
import { ICON_DATASET_KEY, ICON_EPOCH_KEY } from './db/iconSchema'

/** 从 settings 行解析图标元数据：数据集身份 + 全局图标标志位。缺失或非法的字段省略。 */
export function iconMetadataFromRows(rows: Array<{ key: string; value: string | null }>): IconDataMetadata {
  const metadata: IconDataMetadata = {}
  const dataset = rows.find(row => row.key === ICON_DATASET_KEY)?.value
  if (dataset) {
    try {
      const epoch: unknown = JSON.parse(dataset)
      if (typeof epoch === 'string' && /^[a-f0-9]{32}$/.test(epoch)) metadata.dataset_epoch = epoch
    } catch { /* 非法值按缺失处理 */ }
  }
  const counter = Number(rows.find(row => row.key === ICON_EPOCH_KEY)?.value ?? NaN)
  if (Number.isSafeInteger(counter) && counter >= 0) metadata.icon_epoch = counter
  return metadata
}
