import { iconLocalStore, iconObjectKey, iconUrlHasAccessKey, iconVersionFromUrl, type IconLocalStore, type IconObjectType } from './iconLocalStore'

export interface IconViewInput {
  id: number
  object_type?: IconObjectType
  icon_display?: 'image' | 'text' | 'empty'
  /** 组件原本要请求的同源对象代理 URL（可能带 key）。 */
  online_url?: string
  visible: boolean
  preview?: boolean
  [field: string]: unknown
}
/** active=true 时组件只显示 url（空串表示暂不显示）；active=false 时组件走自己的原生加载路径。 */
export interface LocalIconState { active: boolean; url: string; pending: boolean }
export const emptyLocalIcon: LocalIconState = { active: false, url: '', pending: false }

function objectRoute(type: IconObjectType, id: number): string {
  return `/api/${type === 'category' ? 'category-icon' : 'icon'}/${id}`
}

/** 每个渲染图标的视图：本地优先，未命中时下载并落盘；下载失败交还组件原有的回退与重试逻辑。 */
export function createLocalIconView(onChange: (value: LocalIconState) => void, store: () => IconLocalStore = iconLocalStore) {
  let input: IconViewInput | null = null
  let signature = ''
  let sequence = 0
  let disposed = false
  let presentation = emptyLocalIcon
  let shown: { key: string; version: string } | null = null

  function publish(value: LocalIconState) {
    if (value.active === presentation.active && value.url === presentation.url && value.pending === presentation.pending) return
    presentation = value
    onChange(value)
  }

  function update(force = false) {
    if (disposed || !input) return
    const type = input.object_type ?? 'bookmark'
    const id = Number(input.id)
    const online = input.online_url ?? ''
    const route = Number.isSafeInteger(id) && id > 0 ? objectRoute(type, id) : ''
    const active = Boolean(route) && !input.preview && input.icon_display !== 'text' && input.icon_display !== 'empty' &&
      (online === route || online.startsWith(route + '?'))
    if (!active) {
      signature = ''
      sequence++
      shown = null
      publish(emptyLocalIcon)
      return
    }
    const key = iconObjectKey(type, id)
    const version = iconVersionFromUrl(online)
    const isPrivate = iconUrlHasAccessKey(online)
    const next = [key, version, isPrivate, input.visible].join('\n')
    if (!force && next === signature) return
    signature = next
    const own = ++sequence
    const local = store()
    const hit = local.peek(key, version)
    if (hit) {
      shown = { key, version }
      publish({ active: true, url: input.visible ? hit : '', pending: false })
      return
    }
    shown = null
    if (!input.visible) { publish({ active: true, url: '', pending: false }); return }
    publish({ active: true, url: '', pending: true })
    void local.resolve(key, version, online, isPrivate).then(url => {
      if (disposed || own !== sequence) return
      if (url) {
        shown = { key, version }
        publish({ active: true, url, pending: false })
      } else {
        // 没拿到可落盘的真实图片（兜底图、网络失败、私密对象缺授权）：交还组件原有路径。
        publish(emptyLocalIcon)
      }
    })
  }

  return {
    set(value: IconViewInput) { input = { ...value }; update() },
    /** 组件报告本地图片渲染失败：丢弃该条目并交还原有路径。 */
    failed() {
      if (shown) store().invalidate(shown.key, shown.version)
      shown = null
      sequence++
      publish(emptyLocalIcon)
    },
    destroy() { disposed = true; sequence++ },
  }
}
