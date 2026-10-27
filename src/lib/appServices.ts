import { subscribeMutationDataVersion } from './api'
import { recordMutationDataVersion } from './dataService'
import { clearIconAccessKey } from './iconAccessKey'
import { iconLocalStore } from './iconLocalStore'
import { authStore } from './stores'

// 应用级模块之间的接线集中在这里，由 main.ts 在挂载 App 之前显式调用一次。
// 各模块自身不在加载时互相注册回调，也不直接引用彼此的单例：
// - authStore 登出开始 → 删除本机私密图标条目（会话过期等由 dataService 的会话订阅兜底）；
// - authStore 会话消失 → 清理图标访问 key；
// - 写接口回报的 data_version → dataService 判断写后是否需要整包重拉。
let initialized = false
let stopMutationVersions: (() => void) | null = null

export function initAppServices(): void {
  if (initialized) return
  initialized = true
  authStore.configureLifecycle({
    onLogoutStart: () => { void iconLocalStore().clearPrivate() },
    onSessionCleared: clearIconAccessKey,
  })
  stopMutationVersions = subscribeMutationDataVersion(recordMutationDataVersion)
}

/** 仅供测试：撤销接线，让下一次 initAppServices() 重新接上。 */
export function resetAppServicesForTest(): void {
  initialized = false
  authStore.configureLifecycle(null)
  stopMutationVersions?.()
  stopMutationVersions = null
}
