// Versioned object-image identity shared by the Worker and the client.
export const ICON_MAX_BYTES = 512 * 1024

export type IconObjectType = 'bookmark' | 'category'
export interface IconDescriptor {
  object_type: IconObjectType
  object_id: number
  dataset_epoch: string
  write_epoch: number
  state: 'ready' | 'unknown' | 'empty' | 'text'
  content_revision: string | null
}

export function isIconRevision(value: unknown): value is string {
  return typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value)
}

/**
 * 随聚合数据与 /api/data/version 返回的图标元数据。
 * - dataset_epoch：数据集身份（恢复 / 整库导入时更换）。
 * - icon_epoch：全局图标标志位，任何书签 / 分类图标、可见性或对象增删都会递增（D1 触发器维护）。
 */
export interface IconDataMetadata {
  dataset_epoch?: string
  icon_epoch?: number
}

export async function iconBytesRevision(bytes: Uint8Array, mime: string): Promise<string> {
  const prefix = new TextEncoder().encode('cf-navs-icon-v1\n' + mime + '\n')
  const input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return 'sha256-' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}

export function isIconDescriptor(value: unknown): value is IconDescriptor {
  if (!value || typeof value !== 'object') return false
  const d = value as IconDescriptor
  return ['bookmark', 'category'].includes(d.object_type) && Number.isSafeInteger(d.object_id) && d.object_id > 0 &&
    typeof d.dataset_epoch === 'string' && /^[a-f0-9]{32}$/.test(d.dataset_epoch) && Number.isSafeInteger(d.write_epoch) && d.write_epoch >= 0 &&
    ['ready', 'unknown', 'empty', 'text'].includes(d.state) && (d.state === 'ready' ? isIconRevision(d.content_revision) : d.content_revision === null)
}
