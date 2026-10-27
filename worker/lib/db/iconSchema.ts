// Keep the installation DDL in schema.sql in sync. No image backfill during migration.
export const ICON_DATASET_KEY = 'icon_dataset_epoch'
export const INITIALIZE_ICON_DATASET_SQL = `INSERT OR IGNORE INTO settings (key, value)
  VALUES ('icon_dataset_epoch', json_quote(lower(hex(randomblob(16)))))`
export const REPLACE_ICON_DATASET_SQL = `INSERT OR REPLACE INTO settings (key, value)
  VALUES ('icon_dataset_epoch', json_quote(lower(hex(randomblob(16)))))`

// 全局图标标志位（图标本地优先缓存 v2）。任何可能改变客户端图标显示的变化都递增它：
// 对象增删、图标来源 / 正文 / 版本变化、可见性（is_private、所属分类）变化、参与图标 URL
// 版本的标题与链接变化。客户端只用它判断是否需要对照数据清理本地条目；逐个图标是否重下
// 由 URL 版本决定，所以多递增几次只是多一次本地扫描，不会多请求图片。
export const ICON_EPOCH_KEY = 'icon_epoch'
export const INITIALIZE_ICON_EPOCH_SQL = `INSERT OR IGNORE INTO settings (key, value) VALUES ('icon_epoch', '0')`
const BUMP_ICON_EPOCH = `UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'icon_epoch';`

export const ICON_EPOCH_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_epoch_insert AFTER INSERT ON bookmarks
  BEGIN ${BUMP_ICON_EPOCH} END`,
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_epoch_delete AFTER DELETE ON bookmarks
  BEGIN ${BUMP_ICON_EPOCH} END`,
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_epoch_update
  AFTER UPDATE OF icon, icon_source, icon_blob, icon_revision, is_private, category_id, title, url ON bookmarks
  WHEN NEW.icon IS NOT OLD.icon OR NEW.icon_source IS NOT OLD.icon_source OR NEW.icon_blob IS NOT OLD.icon_blob
    OR NEW.icon_revision IS NOT OLD.icon_revision OR NEW.is_private IS NOT OLD.is_private
    OR NEW.category_id IS NOT OLD.category_id OR NEW.title IS NOT OLD.title OR NEW.url IS NOT OLD.url
  BEGIN ${BUMP_ICON_EPOCH} END`,
  `CREATE TRIGGER IF NOT EXISTS category_icon_epoch_insert AFTER INSERT ON categories
  BEGIN ${BUMP_ICON_EPOCH} END`,
  `CREATE TRIGGER IF NOT EXISTS category_icon_epoch_delete AFTER DELETE ON categories
  BEGIN ${BUMP_ICON_EPOCH} END`,
  `CREATE TRIGGER IF NOT EXISTS category_icon_epoch_update
  AFTER UPDATE OF icon, icon_blob, icon_revision, is_private, parent_id, title ON categories
  WHEN NEW.icon IS NOT OLD.icon OR NEW.icon_blob IS NOT OLD.icon_blob OR NEW.icon_revision IS NOT OLD.icon_revision
    OR NEW.is_private IS NOT OLD.is_private OR NEW.parent_id IS NOT OLD.parent_id OR NEW.title IS NOT OLD.title
  BEGIN ${BUMP_ICON_EPOCH} END`,
]

export const BOOKMARK_ICON_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_legacy_body
  AFTER UPDATE OF icon_blob ON bookmarks
  WHEN NEW.icon_blob IS NOT OLD.icon_blob
    AND NEW.icon_revision IS OLD.icon_revision
    AND NEW.icon_write_epoch = OLD.icon_write_epoch
  BEGIN
    UPDATE bookmarks SET icon_revision = NULL, icon_write_epoch = OLD.icon_write_epoch + 1
      WHERE id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_legacy_source
  AFTER UPDATE OF icon, icon_source ON bookmarks
  WHEN (NEW.icon IS NOT OLD.icon OR NEW.icon_source IS NOT OLD.icon_source)
    AND NEW.icon_write_epoch = OLD.icon_write_epoch
  BEGIN
    UPDATE bookmarks SET icon_blob = NULL, icon_revision = NULL, icon_write_epoch = OLD.icon_write_epoch + 1
      WHERE id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS bookmark_icon_publish
  AFTER UPDATE OF icon_revision, icon, icon_source ON bookmarks
  WHEN (OLD.icon_revision IS NOT NULL AND NEW.icon_revision IS NOT OLD.icon_revision)
    OR NEW.icon IS NOT OLD.icon OR NEW.icon_source IS NOT OLD.icon_source
  BEGIN
    INSERT OR REPLACE INTO settings (key, value)
      VALUES ('data_version', json_quote(lower(hex(randomblob(16)))));
  END`,
]

export const CATEGORY_ICON_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS category_icon_legacy_body
  AFTER UPDATE OF icon_blob ON categories
  WHEN NEW.icon_blob IS NOT OLD.icon_blob
    AND NEW.icon_revision IS OLD.icon_revision
    AND NEW.icon_write_epoch = OLD.icon_write_epoch
  BEGIN
    UPDATE categories SET icon_revision = NULL, icon_write_epoch = OLD.icon_write_epoch + 1 WHERE id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS category_icon_legacy_source
  AFTER UPDATE OF icon ON categories
  WHEN NEW.icon IS NOT OLD.icon AND NEW.icon_write_epoch = OLD.icon_write_epoch
  BEGIN
    UPDATE categories SET icon_blob = NULL, icon_revision = NULL, icon_write_epoch = OLD.icon_write_epoch + 1 WHERE id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS category_icon_publish
  AFTER UPDATE OF icon_revision, icon ON categories
  WHEN (OLD.icon_revision IS NOT NULL AND NEW.icon_revision IS NOT OLD.icon_revision) OR NEW.icon IS NOT OLD.icon
  BEGIN
    INSERT OR REPLACE INTO settings (key, value) VALUES ('data_version', json_quote(lower(hex(randomblob(16)))));
  END`,
]
