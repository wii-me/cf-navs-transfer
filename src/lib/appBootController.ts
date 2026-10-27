import type { InstallReq, InstallStatusResp, LoginResp } from '../../shared/types'
import { getErrorMessage, isUnauthorizedError } from './api'
import {
  canUseInstalledFallback,
  hasInstalledHint,
  installationCommittedAfterFailure,
  isInstallPath,
  isRecoverPath,
  normalizeInstallError,
  setInstalledHint,
  shouldProbeInstallStatus,
  shouldRecheckInstallAfterDataError,
  toInstallScreenState,
  type InstallScreenState,
} from './appInstall'
import { createHomeGateState, shouldRevealHomeFromLocalSnapshot, type AppView } from './appNavigation'

// 启动 / 安装 / 找回流程（App.svelte 拆分第 6 步，代码审查三轮第 12 项）。
//
// 与 appConfirmDialog 的控制器一样用普通闭包而非 store：控制器只持有启动专属状态
// （booting / installState / recoverActive / 最近一次数据加载异常），每次赋值后把整份快照
// 交给 `onChange`；与其它用例共享的 rootError / currentView / loginModalOpen 仍归 App 所有，
// 通过注入的读写回调在原先完全相同的时机读写。语句顺序、await 位置与原 App 实现逐条一致，
// 不额外加入「过期响应」防护：并发的 initializeApp 与原先一样各自跑完、按完成顺序覆盖状态。

export interface AppBootState {
  booting: boolean
  installState: InstallScreenState
  recoverActive: boolean
}

export type InstallHintStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface InstallCredentials {
  setupToken: string
  username: string
  password: string
}

export interface AppBootDeps {
  onChange: (state: AppBootState) => void
  installApi: {
    status: () => Promise<InstallStatusResp>
    install: (payload: InstallReq, setupToken: string) => Promise<LoginResp>
  }
  getInstallHintStorage: () => InstallHintStorage | null
  /** 当前路径；没有 window（SSR / 测试）时返回 null。 */
  getPathname: () => string | null
  replacePath: (pathname: string) => void
  clearCachedAdminData: () => Promise<void>
  clearCachedPublicData: () => Promise<void>
  setSession: (session: LoginResp | null) => void
  initializeAuth: () => Promise<void>
  resetAdminData: () => void
  isLoggedIn: () => boolean
  refreshLoggedInData: () => Promise<unknown>
  refreshPublicData: (progressive?: boolean) => Promise<unknown>
  getPublicMode: () => boolean | null | undefined
  isAdminPath: () => boolean
  ensureLazyComponent: (name: 'LoginModal' | 'Admin') => Promise<unknown>
  getRootError: () => string
  setRootError: (message: string) => void
  setLoginModalOpen: (open: boolean) => void
  setCurrentView: (view: AppView) => void
}

export interface AppBootController {
  getState: () => AppBootState
  /**
   * onMount 入口：直达 /recover 时只进入找回流程并返回 false（与原先一样不继续启动，
   * 调用方也不安装焦点刷新）；否则发起 initializeApp 并返回 true。
   */
  start: () => boolean
  /** 完整启动流程。参数沿用原签名的「真值即跳过安装探测」语义，只供内部（安装完成后）传 true。 */
  initializeApp: (installStatusKnown?: unknown) => Promise<void>
  /**
   * 安装页「重新检查」按钮的处理器：总是重新探测安装状态并重置 installState。
   * 不接收参数——按钮以 on:click 直接接线，传入的 MouseEvent 不能流进 initializeApp 的
   * installStatusKnown（代码审查三轮第 13 项）。
   */
  retryInstallStatus: () => Promise<void>
  install: (value: InstallCredentials) => Promise<void>
  /** dataService 的 onRootError：记下原始异常，供启动流程判断是否回头复核安装状态。 */
  recordDataError: (error: unknown) => void
  /** dataService 的 onLocalSnapshotRestored：启动期间先用本地快照揭开首页。 */
  revealHomeFromCurrentData: () => void
  enterRecover: () => void
  recovered: (session: LoginResp) => Promise<void>
  goInstall: () => void
  cancelRecover: () => void
}

export function getBrowserInstallHintStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createAppBootController(deps: AppBootDeps): AppBootController {
  let booting = true
  let installState: InstallScreenState = { type: 'checking' }
  let recoverActive = false
  // 数据加载失败时的原始异常，用来判断是否需要回头复核安装状态。
  let lastDataError: unknown = null

  function getState(): AppBootState {
    return { booting, installState, recoverActive }
  }

  function emit(): void {
    deps.onChange(getState())
  }

  function setBooting(next: boolean): void {
    booting = next
    emit()
  }

  function setInstallState(next: InstallScreenState): void {
    installState = next
    emit()
  }

  function setRecoverActive(next: boolean): void {
    recoverActive = next
    emit()
  }

  function rememberInstalled(installed: boolean): void {
    setInstalledHint(deps.getInstallHintStorage(), installed)
  }

  function onInstallPath(): boolean {
    const pathname = deps.getPathname()
    return pathname !== null && isInstallPath(pathname)
  }

  async function enterInstalledApp(session: LoginResp | null): Promise<void> {
    await Promise.all([deps.clearCachedAdminData(), deps.clearCachedPublicData()])
    rememberInstalled(true)
    deps.setSession(session)
    deps.replacePath('/')
    setInstallState({ type: 'checking' })
    await initializeApp(true)
  }

  async function checkInstallStatus(forceProbe = false): Promise<boolean> {
    const installedHint = hasInstalledHint(deps.getInstallHintStorage())
    const pathname = deps.getPathname() ?? '/'

    // 浏览器已经记住装过时直接放行：这个探测过去无条件串行阻塞在数据加载之前，
    // 每次打开页面白白多一个网络往返。标记过期的情况由 recheckInstallAfterDataError 兜底。
    if (!shouldProbeInstallStatus({ installedHint, pathname, forceProbe })) {
      return true
    }

    setInstallState({ type: 'checking' })

    try {
      const status = await deps.installApi.status()
      if (status.state !== 'installed') {
        if (canUseInstalledFallback(status, installedHint)) {
          if (onInstallPath()) {
            deps.replacePath('/')
          }
          return true
        }

        rememberInstalled(false)
        deps.replacePath('/install')
        setInstallState(toInstallScreenState(status))
        setBooting(false)
        return false
      }

      rememberInstalled(true)
      if (onInstallPath()) {
        deps.replacePath('/')
      }
      return true
    } catch (error) {
      if (installedHint) {
        if (onInstallPath()) {
          deps.replacePath('/')
        }
        return true
      }

      setInstallState({ type: 'status_error', message: normalizeInstallError(error) })
      setBooting(false)
      return false
    }
  }

  // 跳过启动探测的代价：数据库被重置或重新绑定后，本地的「装过」标记会过期。
  // 数据加载因服务端错误失败时回头复核一次，把用户带回安装页。
  async function recheckInstallAfterDataError(error: unknown): Promise<boolean> {
    if (!shouldRecheckInstallAfterDataError(error)) return false
    return !await checkInstallStatus(true)
  }

  async function install(value: InstallCredentials): Promise<void> {
    if (installState.type !== 'pending' || installState.status.state !== 'needs_install') return

    const pendingStatus = installState.status
    setInstallState({ type: 'installing', status: pendingStatus })

    try {
      const session = await deps.installApi.install(
        { username: value.username, password: value.password },
        value.setupToken,
      )
      await enterInstalledApp(session)
    } catch (error) {
      if (await installationCommittedAfterFailure(deps.installApi.status)) {
        await enterInstalledApp(null)
        return
      }

      setInstallState({
        type: 'pending',
        status: pendingStatus,
        error: normalizeInstallError(error),
      })
    }
  }

  async function initializeApp(installStatusKnown: unknown = false): Promise<void> {
    booting = true
    emit()
    deps.setRootError('')
    lastDataError = null

    if (!installStatusKnown && !await checkInstallStatus()) {
      return
    }

    try {
      await deps.initializeAuth()
    } catch (error) {
      deps.setRootError(getErrorMessage(error))
    }

    deps.resetAdminData()
    if (deps.isLoggedIn()) {
      try {
        await deps.refreshLoggedInData()
      } catch (error) {
        if (isUnauthorizedError(error)) {
          deps.setSession(null)
          deps.resetAdminData()
          await deps.clearCachedAdminData()
        } else {
          if (await recheckInstallAfterDataError(error)) return
          deps.setRootError(getErrorMessage(error))
        }

        await deps.refreshPublicData()
      }
    } else {
      await deps.refreshPublicData(true)
      if (deps.getRootError() && await recheckInstallAfterDataError(lastDataError)) return
    }

    const homeGate = createHomeGateState({
      publicMode: deps.getPublicMode(),
      authenticated: deps.isLoggedIn(),
    })
    if (homeGate.loginModalOpen) {
      await deps.ensureLazyComponent('LoginModal')
    }
    deps.setLoginModalOpen(homeGate.loginModalOpen)
    if (deps.isAdminPath() && deps.isLoggedIn()) {
      await deps.ensureLazyComponent('Admin')
      deps.setCurrentView('admin')
      deps.setLoginModalOpen(false)
    } else {
      deps.setCurrentView(homeGate.view)
    }
    setBooting(false)
  }

  function revealHomeFromCurrentData(): void {
    const homeGate = createHomeGateState({
      publicMode: deps.getPublicMode(),
      authenticated: deps.isLoggedIn(),
    })
    if (!shouldRevealHomeFromLocalSnapshot({
      booting,
      adminPath: deps.isAdminPath(),
      homeView: homeGate.view,
    })) return

    deps.setLoginModalOpen(false)
    deps.setCurrentView('home')
    setBooting(false)
  }

  function restartFromRecover(pathname: string): void {
    deps.replacePath(pathname)
    recoverActive = false
    installState = { type: 'checking' }
    emit()
    void initializeApp()
  }

  return {
    getState,
    start() {
      const pathname = deps.getPathname()
      if (pathname !== null && isRecoverPath(pathname)) {
        recoverActive = true
        booting = false
        emit()
        return false
      }
      void initializeApp()
      return true
    },
    initializeApp,
    retryInstallStatus() {
      return initializeApp()
    },
    install,
    recordDataError(error) {
      lastDataError = error
    },
    revealHomeFromCurrentData,
    enterRecover() {
      setRecoverActive(true)
    },
    async recovered(session) {
      setRecoverActive(false)
      await enterInstalledApp(session)
    },
    goInstall() {
      restartFromRecover('/install')
    },
    cancelRecover() {
      restartFromRecover('/')
    },
  }
}
