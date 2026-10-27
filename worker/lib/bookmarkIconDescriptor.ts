import { isIconRevision, type IconDescriptor } from '../../shared/iconDescriptor'
import type { BookmarkIconData } from './db/bookmarks'

/** 书签图标的版本身份（刷新图标接口回传给前端，用于更新显示状态）。 */
export function bookmarkIconDescriptor(id: number, row: BookmarkIconData): IconDescriptor {
  const hasImage = Boolean(row.icon_blob || row.icon?.startsWith('data:image/') || /^https?:/i.test(row.icon ?? ''))
  const ready = Boolean(row.icon_blob || row.icon?.startsWith('data:image/')) && isIconRevision(row.icon_revision)
  return {
    object_type: 'bookmark', object_id: id, dataset_epoch: row.dataset_epoch,
    write_epoch: row.icon_write_epoch,
    state: ready ? 'ready' : hasImage ? 'unknown' : row.icon ? 'text' : 'empty',
    content_revision: ready ? row.icon_revision : null,
  }
}
