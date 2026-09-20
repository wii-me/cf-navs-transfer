import { ErrCode, type InstallBinding, type InstallStatusResp } from '../../shared/types'

export type InstallRoute = 'install' | 'app'

const INSTALLED_HINT_KEY = 'cf-navs:installed'
const INSTALLED_HINT_VALUE = '1'

export type PendingInstallStatus = Exclude<InstallStatusResp, { state: 'installed' }>

export type InstallScreenState =
  | { type: 'checking' }
  | { type: 'pending'; status: PendingInstallStatus; error?: string }
  | { type: 'installing'; status: Extract<PendingInstallStatus, { state: 'needs_install' }> }
  | { type: 'status_error'; message: string }

export interface InstallViewState {
  mode:
  | 'needs_install'
  | 'setup_token_missing'
  | 'bindings_missing'
  | 'database_unreachable'
  | 'session_store_unreachable'
  | 'status_error'
  missingBindings: InstallBinding[]
  schemaVersion: number | null
  installing: boolean
  error: string
}

export function isInstallPath(pathname: string): boolean {
  return pathname === '/install' || pathname.startsWith('/install/')
}

export function isRecoverPath(pathname: string): boolean {
  return pathname === '/recover' || pathname.startsWith('/recover/')
}

// 启动时是否需要探测 `/api/install/status`。
//
// 这个探测过去无条件发出，而且串行阻塞在所有数据加载之前——每次打开页面都白白
// 多一个完整的网络往返加两次 D1 查询（可达性探测 + 三个 key 的读取）。浏览器已经
// 记住装过之后就没有再问的必要。
//
// 保留三种仍然必须探测的情况：
// - 本地没有安装标记（全新浏览器、清过站点数据、或者确实还没装）；
// - 用户主动访问 `/install`，这时必须拿到真实状态而不是本地猜测；
// - 数据加载因服务端错误失败后的复核（由调用方传 `forceProbe`），
//   用来覆盖「数据库被重置 / 重新绑定」这种本地标记已经过期的情况。
export function shouldProbeInstallStatus(input: {
  installedHint: boolean
  pathname: string
  forceProbe?: boolean
}): boolean {
  return Boolean(input.forceProbe) || !input.installedHint || isInstallPath(input.pathname)
}

// 数据加载失败后要不要回头复核安装状态。
//
// 只认服务端错误：未登录、公开模式关闭都是正常的业务分支，网络错误说明根本没连上
// 服务端，这些情况下再发一个探测请求没有意义，只会在弱网时雪上加霜。
export function shouldRecheckInstallAfterDataError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const status = (error as { status?: unknown } | null)?.status

  // `status: 0` 是 api.ts 对「请求根本没到服务端」的约定，它同时带 SERVER_ERROR。
  // 弱网时再补一个探测请求只会雪上加霜，而且拿不到任何新信息。必须排在前面判断。
  if (status === 0) return false
  if (code === ErrCode.UNAUTHORIZED || code === ErrCode.FORBIDDEN) return false
  if (typeof status === 'number' && status >= 500) return true
  return code === ErrCode.SERVER_ERROR
}

export function getInstallRoute(status: InstallStatusResp): InstallRoute {
  return status.state === 'installed' ? 'app' : 'install'
}

export function toInstallScreenState(status: PendingInstallStatus): InstallScreenState {
  return { type: 'pending', status }
}

export function getInstallViewState(state: InstallScreenState): InstallViewState | null {
  if (state.type === 'checking') return null
  if (state.type === 'status_error') {
    return {
      mode: 'status_error',
      missingBindings: [],
      schemaVersion: null,
      installing: false,
      error: state.message,
    }
  }

  const status = state.status
  if (status.state === 'needs_install') {
    return {
      mode: 'needs_install',
      missingBindings: [],
      schemaVersion: status.schema_version,
      installing: state.type === 'installing',
      error: state.type === 'pending' ? state.error ?? '' : '',
    }
  }
  if (status.state === 'configuration_required') {
    return {
      mode: 'setup_token_missing',
      missingBindings: [],
      schemaVersion: status.schema_version,
      installing: false,
      error: state.type === 'pending' ? state.error ?? '' : '',
    }
  }
  if (status.state === 'bindings_missing') {
    return {
      mode: 'bindings_missing',
      missingBindings: status.missing,
      schemaVersion: null,
      installing: false,
      error: state.type === 'pending' ? state.error ?? '' : '',
    }
  }

  return {
    mode: status.reason,
    missingBindings: [],
    schemaVersion: null,
    installing: false,
    error: state.type === 'pending' ? state.error ?? '' : '',
  }
}

export function hasInstalledHint(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  if (!storage) return false

  try {
    return storage.getItem(INSTALLED_HINT_KEY) === INSTALLED_HINT_VALUE
  } catch {
    return false
  }
}

export function setInstalledHint(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  installed: boolean,
): void {
  if (!storage) return

  try {
    if (installed) {
      storage.setItem(INSTALLED_HINT_KEY, INSTALLED_HINT_VALUE)
    } else {
      storage.removeItem(INSTALLED_HINT_KEY)
    }
  } catch {
    // Browser storage can be unavailable; the status probe remains authoritative.
  }
}

export function canUseInstalledFallback(status: InstallStatusResp, installedHint: boolean): boolean {
  return installedHint && status.state === 'unavailable'
}

export async function installationCommittedAfterFailure(
  getStatus: () => Promise<InstallStatusResp>,
): Promise<boolean> {
  try {
    return (await getStatus()).state === 'installed'
  } catch {
    return false
  }
}

export function replaceBrowserPath(pathname: string): void {
  if (typeof window === 'undefined' || window.location.pathname === pathname) {
    return
  }

  window.history.replaceState(null, '', `${pathname}${window.location.search}${window.location.hash}`)
}

export function normalizeInstallError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return '无法连接安装服务，请检查网络后重试。'
}
