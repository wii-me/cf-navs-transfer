import type { LoginResp, LogoutResp, LogoutRevocationFailure, Settings } from '../../shared/types'
import type { AdminTab } from './adminTypes'
import { getErrorMessage, isUnauthorizedError } from './api'
import { createHomeGateState, type AppView } from './appNavigation'
import { toastStore } from './toast'

export interface AuthUIRegion {
  loginModalOpen: boolean
  currentView: AppView | null
}

/**
 * Target UI state after clicking "open login" button.
 * Always opens the modal; changes view to 'login' only when the home is not visible.
 */
// currentView 保留在签名里是为了让调用点读起来完整，但结果只取决于 canSeeHome。
export function targetAfterLoginOpen(canSeeHome: boolean, _currentView: AppView): AuthUIRegion {
  return {
    loginModalOpen: true,
    currentView: canSeeHome ? null : 'login',
  }
}

/**
 * Target UI state after closing the login modal.
 * On a private site the modal must stay open and force 'login' view.
 * On a public site the modal closes without changing the current view.
 */
export function targetAfterLoginClose(canSeeHome: boolean): AuthUIRegion {
  if (!canSeeHome) {
    return { loginModalOpen: true, currentView: 'login' }
  }
  return { loginModalOpen: false, currentView: null }
}

/**
 * Target UI state after a successful login.
 */
export function targetAfterLoginSuccess(): AuthUIRegion {
  return { loginModalOpen: false, currentView: 'home' }
}

/**
 * Target UI state after logout completes.
 * Delegates home-gate resolution (public vs private) to appNavigation.
 */
export function targetAfterLogout(publicMode: boolean | undefined): AuthUIRegion {
  const homeGate = createHomeGateState({
    publicMode,
    authenticated: false,
  })
  return { loginModalOpen: homeGate.loginModalOpen, currentView: homeGate.view }
}

const LOGOUT_REVOCATION_CAUSE: Record<LogoutRevocationFailure, string> = {
  store_unavailable: '会话存储暂时不可用',
  store_unconfigured: '部署缺少 SESSION 绑定',
}

/**
 * Warning to surface when logout cleared the local session but the server could
 * not revoke the token. Returns null when nothing needs saying.
 *
 * 会话是无状态 JWT：撤销名单没写进去，旧 token 就一直有效到 exp（部署默认 30 天）。
 * 本地登录态照常清除，所以这不是失败，但共享设备上必须让用户知道。
 */
export function logoutRevocationWarning(result: LogoutResp | null): string | null {
  if (!result || result.revoked) return null

  // reason 来自网络响应，可能是本客户端还不认识的取值，因此不硬取索引。
  const cause: string | undefined = LOGOUT_REVOCATION_CAUSE[result.reason]
  return `已退出登录，但服务端未能作废旧的登录令牌${cause ? `（${cause}）` : ''}。这台设备上的登录态已清除；如果担心令牌被别人复用，请修改密码——改密码会立即作废全部会话。`
}

/**
 * Target UI state after a password change.
 */
export function targetAfterPasswordChange(): AuthUIRegion {
  return { loginModalOpen: true, currentView: 'login' }
}

/**
 * Which modal/state regions should be reset when auth changes
 * (logout / password change).
 */
export interface AuthResetMask {
  resetCategories: boolean
  resetBookmarks: boolean
  resetSettings: boolean
  resetAdminStore: boolean
  clearAdminCache: boolean
}

export function getAuthResetMask(): AuthResetMask {
  return {
    resetCategories: true,
    resetBookmarks: true,
    resetSettings: true,
    resetAdminStore: true,
    clearAdminCache: true,
  }
}

/**
 * Applies an AuthUIRegion to mutable primitives.
 * Returns a partial with non-null fields so the caller can assign only what changed.
 */
export function applyAuthUIRegion(
  region: AuthUIRegion,
): { loginModalOpen: boolean; currentView?: AppView } {
  const result: { loginModalOpen: boolean; currentView?: AppView } = {
    loginModalOpen: region.loginModalOpen,
  }
  if (region.currentView !== null) {
    result.currentView = region.currentView
  }
  return result
}

/** App owns auth-view intent; asynchronous logout must not close a newer dialog. */
export function createAuthViewIntent() {
  let epoch = 0
  return {
    begin() {
      const captured = ++epoch
      return () => captured === epoch
    },
    invalidate() { epoch += 1 },
  }
}

export type AuthViewIntent = ReturnType<typeof createAuthViewIntent>

// 认证用例：打开 / 关闭登录框、登录、登出、进入后台、忘记密码，以及登录态数据加载
// （`ensureLoggedInDataLoaded`）、变更后刷新与统计页刷新（App.svelte 拆分第 7d 步，代码审查三轮第 17 项）。
//
// 不持有状态：loginModalOpen / currentView / rootError 仍归 App 经回调写入，认证视图意图由 App 创建并注入
// （改密也要作废它）。登出按原顺序经注入的函数重置分类编辑框 → 设置状态 → 书签编辑框。
// 语句顺序与 await 位置与原 App 实现逐条一致，三个原先套了一层 async 的处理器（打开登录 / 进入后台 / 登录）
// 同样保留包装，兑现时机逐个微任务一致。

export interface AuthControllerDeps {
  authViewIntent: AuthViewIntent
  authStore: {
    login: (username: string, password: string) => Promise<unknown>
    logout: () => Promise<LogoutResp | null>
    resetError: () => void
  }
  isLoggedIn: () => boolean
  isAdminPath: () => boolean
  /** App 的 `canSeeHome`（公开站点或已登录）。 */
  getCanSeeHome: () => boolean
  getPublicMode: () => boolean | null | undefined
  /** `get(adminStore)`。 */
  readAdminState: () => { loaded: boolean; data: { settings: Settings | null } }
  setSession: (session: LoginResp | null) => void
  resetAdminData: () => void
  clearCachedAdminData: () => Promise<void>
  refreshLoggedInData: (force?: boolean) => Promise<unknown>
  /** dataService.confirmLoggedInDataAfterLocalMutation。 */
  confirmLoggedInDataAfterLocalMutation: () => Promise<unknown>
  refreshPublicData: () => Promise<unknown>
  applyConfigFromSettings: (settings: Settings) => void
  ensureLazyComponent: (name: 'LoginModal' | 'Admin') => Promise<unknown>
  replacePath: (pathname: string) => void
  /** `boot.enterRecover`。 */
  enterRecover: () => void
  /** 登出时按此顺序调用：分类编辑框、设置状态、书签编辑框。 */
  resetCategories: () => void
  resetSettings: () => void
  resetBookmarks: () => void
  setRootError: (message: string) => void
  setLoginModalOpen: (open: boolean) => void
  setCurrentView: (view: AppView) => void
}

export interface AuthController {
  openLogin: () => Promise<void>
  closeLogin: () => Promise<void>
  switchToAdmin: () => Promise<void>
  /** 失败不抛出（authStore 已记录错误）。 */
  login: (payload: { username: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  forgotPassword: () => void
  ensureLoggedInDataLoaded: () => Promise<boolean>
  refreshAdminDataAfterMutation: () => Promise<void>
  /** 写入结果已在本地应用后的版本确认；失败同样只提示、不抛出。 */
  confirmAdminDataAfterLocalMutation: () => Promise<void>
  selectAdminTab: (tab: AdminTab) => Promise<void>
}

export function createAuthController(deps: AuthControllerDeps): AuthController {
  const {
    authViewIntent,
    authStore,
    isLoggedIn,
    isAdminPath,
    getCanSeeHome,
    getPublicMode,
    readAdminState,
    setSession,
    resetAdminData,
    clearCachedAdminData,
    refreshLoggedInData,
    confirmLoggedInDataAfterLocalMutation,
    refreshPublicData,
    applyConfigFromSettings,
    ensureLazyComponent,
    replacePath,
    enterRecover,
    resetCategories,
    resetSettings,
    resetBookmarks,
    setRootError,
    setLoginModalOpen,
    setCurrentView,
  } = deps

  async function ensureLoggedInDataLoaded(): Promise<boolean> {
    if (!isLoggedIn()) return false

    const current = readAdminState()
    if (current.loaded && current.data.settings) {
      return true
    }

    try {
      await refreshLoggedInData()
      return isLoggedIn() && readAdminState().loaded
    } catch (error) {
      if (isUnauthorizedError(error)) {
        setSession(null)
        resetAdminData()
        await clearCachedAdminData()
        await refreshPublicData()
        await openLogin()
        return false
      }

      setRootError(getErrorMessage(error))
      return false
    }
  }

  async function refreshAdminDataAfterMutation(): Promise<void> {
    try {
      await refreshLoggedInData(true)
    } catch (error) {
      // 写入已经成功；刷新失败时保留本地即时结果，并提示用户稍后重试。
      setRootError(getErrorMessage(error))
    }
  }

  async function confirmAdminDataAfterLocalMutation(): Promise<void> {
    try {
      await confirmLoggedInDataAfterLocalMutation()
    } catch (error) {
      setRootError(getErrorMessage(error))
    }
  }

  async function selectAdminTab(tab: AdminTab): Promise<void> {
    if (tab !== 'analytics') return

    try {
      await refreshLoggedInData(true)
    } catch (error) {
      setRootError(getErrorMessage(error))
    }
  }

  async function openLoginUseCase(): Promise<void> {
    authViewIntent.invalidate()
    setRootError('')
    authStore.resetError()
    await ensureLazyComponent('LoginModal')
    setLoginModalOpen(true)
    if (!getCanSeeHome()) setCurrentView('login')
  }
  async function openLogin(): Promise<void> {
    await openLoginUseCase()
  }

  async function closeLogin(): Promise<void> {
    authViewIntent.invalidate()
    authStore.resetError()
    if (!getCanSeeHome()) {
      setLoginModalOpen(true)
      setCurrentView('login')
      return
    }

    setLoginModalOpen(false)
  }

  async function switchToAdmin(): Promise<void> {
    await openAdminUseCase()
  }

  async function completeLoginUseCase(payload: { username: string; password: string }): Promise<void> {
    authViewIntent.invalidate()
    await authStore.login(payload.username, payload.password)
    setLoginModalOpen(false)
    setRootError('')
    await refreshLoggedInData(true)
    if (isAdminPath()) {
      await ensureLazyComponent('Admin')
      setCurrentView('admin')
      return
    }
    setCurrentView('home')
  }
  async function login(payload: { username: string; password: string }): Promise<void> {
    try {
      await completeLoginUseCase(payload)
    } catch {
      // authStore 已经记录错误
    }
  }

  async function completeLogoutUseCase(previousSettings: Settings | null): Promise<string | null> {
    const revocationWarning = logoutRevocationWarning(await authStore.logout())
    if (isLoggedIn()) return revocationWarning
    resetCategories()
    resetSettings()
    resetBookmarks()
    resetAdminData()
    await clearCachedAdminData()
    if (isLoggedIn()) return revocationWarning
    if (previousSettings) {
      applyConfigFromSettings(previousSettings)
    }
    await refreshPublicData()
    return revocationWarning
  }

  async function logout(): Promise<void> {
    const viewIsCurrent = authViewIntent.begin()
    setRootError('')
    const previousSettings = readAdminState().data.settings

    try {
      const revocationWarning = await completeLogoutUseCase(previousSettings)

      const homeGate = createHomeGateState({
        publicMode: getPublicMode(),
        authenticated: false,
      })
      if (viewIsCurrent() && !isLoggedIn()) {
        if (homeGate.loginModalOpen) await ensureLazyComponent('LoginModal')
        // Lazy loading can yield to another login/recovery action as well.
        if (viewIsCurrent() && !isLoggedIn()) {
          setLoginModalOpen(homeGate.loginModalOpen)
          setCurrentView(homeGate.view)
        }
      }
      // 视图先切换，确保全局 Toast 不被登出后的页面切换影响。
      if (revocationWarning) {
        toastStore.addToast(revocationWarning, 'error', { duration: 12000 })
      }
    } catch (error) {
      if (viewIsCurrent()) setRootError(getErrorMessage(error))
    }
  }

  async function openAdminUseCase(): Promise<void> {
    if (!isLoggedIn()) {
      await openLogin()
      return
    }

    if (!await ensureLoggedInDataLoaded()) {
      return
    }

    await ensureLazyComponent('Admin')
    replacePath('/admin')
    setCurrentView('admin')
  }

  function forgotPassword(): void {
    authViewIntent.invalidate()
    // 忘记密码是登录态的子流程，按模态语义处理：不改 URL，避免 pushState 制造一个没有
    // popstate 监听的历史项（后退键会让 URL 与视图错位）。直达 /recover 仍由 onMount 处理。
    setLoginModalOpen(false)
    enterRecover()
  }

  return {
    openLogin,
    closeLogin,
    switchToAdmin,
    login,
    logout,
    forgotPassword,
    ensureLoggedInDataLoaded,
    refreshAdminDataAfterMutation,
    confirmAdminDataAfterLocalMutation,
    selectAdminTab,
  }
}
