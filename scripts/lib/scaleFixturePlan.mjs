// Pure, deterministic fixture plan generator for ordinary object-icon scale testing (IP-P1).
//
// No I/O and no product-source imports. Produces /api/import payloads whose bookmarks exercise
// the ordinary same-origin object icon proxy (/api/icon/:id) without any outbound fetch:
//   - object-icon bookmark: icon = http(s) placeholder + icon_blob = inline image data URI.
//       The aggregate/public SQL reports icon_cached=1, so getBookmarkIconUrl() (src/lib/
//       bookmarkIconDisplay.ts) emits /api/icon/:id, and the proxy (worker/routes/icon.ts)
//       serves the stored blob directly (icon field is never fetched).
//   - inline-icon bookmark: icon = data:image/... + icon_blob = null. Rendered inline, never proxied.
//
// Cold home mounting is structural (src/lib/homeData.ts resolveHomeCategoryForRoot +
// src/views/Home.svelte): each root mounts ONE selected category's bookmarks (its own direct
// bookmarks, or the first child when the root has none); child-category bookmarks mount only on
// tab switch. computeColdHomeMount() mirrors that rule so reported mount counts stay grounded in
// the actual fetched /api/data rather than being asserted. Seeded bookmarks keep click_count=0,
// so the "经常访问" section is empty and contributes no extra mounts.

// A tiny, valid 16x16 SVG. Renders with naturalWidth>0 (not a broken image) both inline and when
// served by the proxy as image/svg+xml. decodeIconDataUri (shared/iconDataUri.ts) accepts it.
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#4f46e5"/></svg>'
const ICON_DATA_URI = 'data:image/svg+xml;base64,' + Buffer.from(ICON_SVG).toString('base64')

// Round-robin split of `total` across `buckets`, remainder front-loaded. Deterministic.
export function distribute(total, buckets) {
  if (!Number.isInteger(total) || total < 0) throw new Error('distribute: total must be a non-negative integer')
  if (!Number.isInteger(buckets) || buckets <= 0) throw new Error('distribute: buckets must be a positive integer')
  const base = Math.floor(total / buckets)
  const extra = total % buckets
  return Array.from({ length: buckets }, (_, index) => base + (index < extra ? 1 : 0))
}

export const TIER_CONFIGS = {
  report150: {
    label: 'report150',
    note: 'Issue #31 reported scale: 150 bookmarks across flat public/private roots; every bookmark mounts on cold home.',
    publicRootCounts: distribute(120, 12),
    privateRootCounts: distribute(30, 3),
    childCounts: [],
    objectIcon: { num: 4, den: 5 },
  },
  home355: {
    label: 'home355',
    note: '355 public cards that actually mount on the cold home (flat public roots), plus a private-root mix.',
    publicRootCounts: distribute(355, 30),
    privateRootCounts: distribute(40, 4),
    childCounts: [],
    objectIcon: { num: 4, den: 5 },
  },
  aggregate583: {
    label: 'aggregate583',
    note: '583 admin-aggregate bookmarks; only each root\'s direct bookmarks mount on cold home, child categories hold the remainder.',
    publicRootCounts: distribute(300, 24),
    privateRootCounts: distribute(55, 5),
    childCounts: distribute(228, 24),
    objectIcon: { num: 5, den: 8 },
  },
}

export const TIER_NAMES = Object.keys(TIER_CONFIGS)

function isObjectIcon(globalIndex, objectIcon) {
  return (globalIndex % objectIcon.den) < objectIcon.num
}

// Visibility gate mirrored from worker/lib/db/aggregates.ts getPublicCategoryIds: a category is
// public only when its whole parent chain is non-private and reaches a root.
export function publicCategoryIdSet(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const visible = new Set()
  for (const category of categories) {
    let current = category
    let hidden = false
    let reachedRoot = false
    const visited = new Set()
    while (current) {
      if (visited.has(current.id)) {
        hidden = true
        break
      }
      visited.add(current.id)
      if (current.is_private === true || current.is_private === 1) {
        hidden = true
        break
      }
      if (current.parent_id == null) {
        reachedRoot = true
        break
      }
      current = byId.get(current.parent_id)
    }
    if (!reachedRoot) hidden = true
    if (!hidden) visible.add(category.id)
  }
  return visible
}

// Cold-home mounted card count for an already-scoped dataset (admin view: pass everything; public
// view: pass only the public-visible categories and their public bookmarks). Each root contributes
// the bookmarks of its default-selected category only; child categories do not auto-mount.
export function computeColdHomeMount(categories, bookmarks) {
  const byCategory = new Map()
  for (const bookmark of bookmarks) {
    const list = byCategory.get(bookmark.category_id) ?? []
    list.push(bookmark)
    byCategory.set(bookmark.category_id, list)
  }
  const childrenByParent = new Map()
  for (const category of categories) {
    if (category.parent_id == null) continue
    const list = childrenByParent.get(category.parent_id) ?? []
    list.push(category)
    childrenByParent.set(category.parent_id, list)
  }
  const roots = categories.filter((category) => category.parent_id == null)
  let mounted = 0
  for (const root of roots) {
    const directCount = byCategory.get(root.id)?.length ?? 0
    const children = (childrenByParent.get(root.id) ?? [])
      .slice()
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id)
    const selected = directCount === 0 && children.length > 0 ? children[0] : root
    mounted += byCategory.get(selected.id)?.length ?? 0
  }
  return mounted
}

export function buildTier(name) {
  const config = TIER_CONFIGS[name]
  if (!config) throw new Error(`unknown tier: ${name}`)

  const categories = []
  const bookmarks = []
  let categoryId = 0
  let globalIndex = 0
  let objectIconBookmarks = 0
  const publicRootIds = []

  const addBookmark = (categoryLocalId, isPrivate) => {
    const object = isObjectIcon(globalIndex, config.objectIcon)
    if (object) objectIconBookmarks += 1
    const id = globalIndex + 1
    bookmarks.push({
      id,
      category_id: categoryLocalId,
      title: `${config.label} bookmark ${id}`,
      url: `https://example.com/${config.label}/${id}`,
      icon: object ? `https://icons.example.invalid/${config.label}/${id}.svg` : ICON_DATA_URI,
      icon_source: object ? 'direct' : 'custom',
      icon_blob: object ? ICON_DATA_URI : null,
      is_private: isPrivate,
      sort: globalIndex,
    })
    globalIndex += 1
  }

  config.publicRootCounts.forEach((count, index) => {
    categoryId += 1
    const id = categoryId
    publicRootIds.push(id)
    categories.push({ id, parent_id: null, title: `${config.label} public root ${index + 1}`, icon: ICON_DATA_URI, is_private: false, sort: index })
    for (let i = 0; i < count; i += 1) addBookmark(id, false)
  })

  config.privateRootCounts.forEach((count, index) => {
    categoryId += 1
    const id = categoryId
    categories.push({ id, parent_id: null, title: `${config.label} private root ${index + 1}`, icon: ICON_DATA_URI, is_private: true, sort: 1000 + index })
    for (let i = 0; i < count; i += 1) addBookmark(id, true)
  })

  config.childCounts.forEach((count, index) => {
    categoryId += 1
    const id = categoryId
    const parentId = publicRootIds[index % publicRootIds.length]
    categories.push({ id, parent_id: parentId, title: `${config.label} child ${index + 1}`, icon: ICON_DATA_URI, is_private: false, sort: index })
    for (let i = 0; i < count; i += 1) addBookmark(id, false)
  })

  const visibleIds = publicCategoryIdSet(categories)
  const publicCategories = categories.filter((category) => visibleIds.has(category.id))
  const publicBookmarks = bookmarks.filter((bookmark) => !bookmark.is_private && visibleIds.has(bookmark.category_id))

  const expected = {
    adminTotalBookmarks: bookmarks.length,
    adminTotalCategories: categories.length,
    publicBookmarks: publicBookmarks.length,
    privateBookmarks: bookmarks.filter((bookmark) => bookmark.is_private).length,
    objectIconBookmarks,
    inlineIconBookmarks: bookmarks.length - objectIconBookmarks,
    objectIconRatio: Number((objectIconBookmarks / bookmarks.length).toFixed(4)),
    coldHomeMountAdmin: computeColdHomeMount(categories, bookmarks),
    coldHomeMountPublic: computeColdHomeMount(publicCategories, publicBookmarks),
  }

  return { name: config.label, note: config.note, categories, bookmarks, expected }
}
