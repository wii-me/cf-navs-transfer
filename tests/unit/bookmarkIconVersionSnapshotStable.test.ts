import { describe, expect, it } from 'vitest'
import { deriveBookmarkCardIconBase } from '../../src/lib/bookmarkCardIconState'
import { projectBookmarkIconSnapshot } from '../../src/lib/iconSnapshot'
import type { PublicBookmark, PublicData } from '../../shared/types'

// 本地数据快照会去掉内嵌 data: 图标正文；网络行与快照行必须得到同一个代理 URL，
// 否则本地优先图标库每次在「网络数据 ↔ 快照数据」之间切换都会把内嵌图标重下一遍。
function row(icon: string, revision: string | null = null): PublicBookmark {
  return {
    id: 1068, category_id: 1, title: 'Embedded', url: 'https://example.com/', icon, icon_source: 'custom',
    icon_background_color: null, icon_blob: null, icon_cached: true, icon_revision: revision, icon_write_epoch: 3,
    description: null, open_method: 1, sort: 0,
  } as PublicBookmark
}
const svg = "data:image/svg+xml;charset=utf-8,<svg xmlns='http://www.w3.org/2000/svg'/>"
const url = (bookmark: PublicBookmark) => deriveBookmarkCardIconBase({ bookmark, iconInView: true }).proxiedHttpIconUrl

describe('bookmark icon proxy version vs local snapshots', () => {
  it('yields the same proxy URL for a network row and its stripped snapshot row', () => {
    const network = row(svg)
    const snapshot = projectBookmarkIconSnapshot({ categories: [], bookmarks: [network] } as unknown as PublicData).bookmarks[0]!
    expect(snapshot.icon).toBeNull()
    expect(url(network)).not.toBe('')
    expect(url(snapshot)).toBe(url(network))
  })

  it('still changes the version when the embedded icon is edited (write epoch / revision)', () => {
    expect(url({ ...row(svg), icon_write_epoch: 4 } as PublicBookmark)).not.toBe(url(row(svg)))
    expect(url(row(svg, 'sha256-' + 'a'.repeat(64)))).not.toBe(url(row(svg, 'sha256-' + 'b'.repeat(64))))
  })

  it('keeps HTTP icon URLs in the version', () => {
    expect(url(row('https://a.example/icon.png'))).not.toBe(url(row('https://b.example/icon.png')))
  })
})
