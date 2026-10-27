import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogoutResp, Settings } from '../../shared/types'
import type { AdminTab } from '../../src/lib/adminTypes'
import { ApiError, getErrorMessage, isUnauthorizedError } from '../../src/lib/api'
import {
  createAuthController,
  createAuthViewIntent,
  logoutRevocationWarning,
  type AuthControllerDeps,
} from '../../src/lib/appAuthController'
import { createHomeGateState, type AppView } from '../../src/lib/appNavigation'
import { toastStore } from '../../src/lib/toast'
import { flush, track, UseCaseWorld, type Plan } from '../helpers/useCaseWorld'

// 代码审查三轮第 17 项：App.svelte 拆分第 7d 步（认证用例）。
// 每个用例在同一份脚本下分别驱动新控制器与逐字复刻的原 App 实现（见文件末尾 legacy），
// 断言两者的依赖调用序列（含每次调用时的完整状态快照；登录态 / adminStore / 公开模式 / canSeeHome 读取、
// 认证视图意图的 begin / invalidate、toast、console.warn 也记入日志）、最终状态与 promise 结果完全一致，
// 再对控制器的结果做语义断言。

interface AppVars { rootError: string; loginModalOpen: boolean; currentView: AppView }

interface Ctx {
  loggedIn: boolean
  canSeeHome: boolean
  adminPath: boolean
  publicMode: boolean | undefined
  adminState: { loaded: boolean; data: { settings: Settings | null } }
}

interface Impl {
  openLogin(): Promise<void>
  closeLogin(): Promise<void>
  switchToAdmin(): Promise<void>
  login(payload: { username: string; password: string }): Promise<void>
  logout(): Promise<void>
  forgotPassword(): void
  ensureLoggedInDataLoaded(): Promise<boolean>
  refreshAdminDataAfterMutation(): Promise<void>
  selectAdminTab(tab: AdminTab): Promise<void>
  read(): AppVars & { loggedIn: boolean }
}

const settingsA = { site_title: 'Mine', public_mode: false } as unknown as Settings
const loadedState = (settings: Settings | null = settingsA) => ({ loaded: true, data: { settings } })
const unauthorized = new ApiError('登录已过期', { status: 401 })
const boom = new Error('boom')
const creds = { username: 'admin', password: 'pw' }

class World extends UseCaseWorld {
  impl!: Impl
  ctx: Ctx
  constructor(plan: Plan, ctx: Partial<Ctx> = {}) {
    super(plan, {
      'authStore.logout': { revoked: true },
    })
    this.ctx = { loggedIn: true, canSeeHome: true, adminPath: false, publicMode: true, adminState: loadedState(), ...ctx }
    this.snapshot = () => this.impl.read()
  }
}

let activeWorld: World | null = null

beforeEach(() => {
  vi.spyOn(toastStore, 'addToast').mockImplementation((message, type, options) => {
    activeWorld?.record('toast', message, type, options)
    return ''
  })
  vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    activeWorld?.record('warn', message)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  activeWorld = null
})

function doubles(w: World, app: AppVars) {
  const realIntent = createAuthViewIntent()
  return {
    authViewIntent: {
      begin: () => {
        w.record('authView.begin')
        return realIntent.begin()
      },
      invalidate: () => {
        w.record('authView.invalidate')
        realIntent.invalidate()
      },
    },
    authStore: {
      login: (username: string, password: string) => w.call('authStore.login', username, password),
      logout: () => w.call<LogoutResp | null>('authStore.logout'),
      resetError: () => { w.callSync('authStore.resetError') },
    },
    isLoggedIn: () => {
      w.record('isLoggedIn')
      return w.ctx.loggedIn
    },
    isAdminPath: () => {
      w.record('isAdminPath')
      return w.ctx.adminPath
    },
    getCanSeeHome: () => {
      w.record('canSeeHome')
      return w.ctx.canSeeHome
    },
    getPublicMode: () => {
      w.record('getPublicMode')
      return w.ctx.publicMode
    },
    readAdminState: () => {
      w.record('readAdminState')
      return w.ctx.adminState
    },
    setSession: (session: unknown) => {
      w.callSync('setSession', session)
      w.ctx.loggedIn = session !== null
    },
    resetAdminData: () => { w.callSync('resetAdminData') },
    clearCachedAdminData: () => w.call<void>('clearCachedAdminData'),
    refreshLoggedInData: (...args: unknown[]) => w.call('refreshLoggedInData', ...args),
    confirmLoggedInDataAfterLocalMutation: () => w.call('confirmLoggedInDataAfterLocalMutation'),
    refreshPublicData: (...args: unknown[]) => w.call('refreshPublicData', ...args),
    applyConfigFromSettings: (settings: Settings) => { w.callSync('applyConfigFromSettings', settings) },
    ensureLazyComponent: (name: string) => w.call('ensure', name),
    replacePath: (pathname: string) => { w.callSync('replacePath', pathname) },
    enterRecover: () => { w.callSync('enterRecover') },
    resetCategories: () => { w.callSync('resetCategories') },
    resetSettings: () => { w.callSync('resetSettings') },
    resetBookmarks: () => { w.callSync('resetBookmarks') },
    setRootError: (message: string) => { app.rootError = message },
    setLoginModalOpen: (open: boolean) => { app.loginModalOpen = open },
    setCurrentView: (view: AppView) => { app.currentView = view },
  }
}

const newAppVars = (): AppVars => ({ rootError: 'old', loginModalOpen: false, currentView: 'home' })

// ---------------------------------------------------------------------------
// 新控制器接到世界上（接线方式与 App.svelte 相同）
// ---------------------------------------------------------------------------

function attachController(w: World): Impl {
  const app = newAppVars()
  const deps: AuthControllerDeps = doubles(w, app)
  const c = createAuthController(deps)
  const impl: Impl = {
    openLogin: c.openLogin,
    closeLogin: c.closeLogin,
    switchToAdmin: c.switchToAdmin,
    login: c.login,
    logout: c.logout,
    forgotPassword: c.forgotPassword,
    ensureLoggedInDataLoaded: c.ensureLoggedInDataLoaded,
    refreshAdminDataAfterMutation: c.refreshAdminDataAfterMutation,
    selectAdminTab: c.selectAdminTab,
    read: () => ({ ...app, loggedIn: w.ctx.loggedIn }),
  }
  w.impl = impl
  return impl
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

interface Result { world: World; impl: Impl; settled: string[] }

interface Scenario {
  name: string
  plan?: Plan
  ctx?: Partial<Ctx>
  drive: (impl: Impl, w: World, settled: string[]) => Promise<void>
  check?: (r: Result) => void
}

const calls = (w: World) => w.log.map(e => e.call)
const loggedOut = (w: UseCaseWorld) => { (w as World).ctx.loggedIn = false }
const loggedIn = (w: UseCaseWorld) => { (w as World).ctx.loggedIn = true }
const OPEN_LOGIN = ['authView.invalidate', 'authStore.resetError', 'ensure', 'canSeeHome']

const scenarios: Scenario[] = [
  // --- ensureLoggedInDataLoaded ---
  {
    name: 'ensure data while logged out: false without reading the store',
    ctx: { loggedIn: false },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ world, settled }) => {
      expect(settled).toEqual(['false'])
      expect(calls(world)).toEqual(['isLoggedIn'])
    },
  },
  {
    name: 'ensure data already loaded with settings: true without a refresh',
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ world, settled }) => {
      expect(settled).toEqual(['true'])
      expect(calls(world)).toEqual(['isLoggedIn', 'readAdminState'])
    },
  },
  {
    name: 'ensure data loaded without settings: refreshes (no force), then true',
    ctx: { adminState: loadedState(null) },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ world, settled }) => {
      expect(settled).toEqual(['true'])
      expect(calls(world)).toEqual(['isLoggedIn', 'readAdminState', 'refreshLoggedInData', 'isLoggedIn', 'readAdminState'])
      expect(world.log[2].args).toEqual([])
    },
  },
  {
    name: 'ensure data not loaded yet: refresh, still not loaded -> false',
    ctx: { adminState: { loaded: false, data: { settings: null } } },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ settled }) => { expect(settled).toEqual(['false']) },
  },
  {
    name: 'ensure data: logged out during the refresh -> false without reading the store again',
    ctx: { adminState: loadedState(null) },
    plan: { refreshLoggedInData: [{ effect: loggedOut }] },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ world, settled }) => {
      expect(settled).toEqual(['false'])
      expect(calls(world).at(-1)).toBe('isLoggedIn')
    },
  },
  {
    name: 'ensure data: 401 clears the session, admin data and cache, refreshes public data, opens login',
    ctx: { adminState: loadedState(null), canSeeHome: false },
    plan: { refreshLoggedInData: [{ error: unauthorized }] },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['false'])
      expect(calls(world)).toEqual([
        'isLoggedIn', 'readAdminState', 'refreshLoggedInData', 'setSession', 'resetAdminData', 'clearCachedAdminData',
        'refreshPublicData', ...OPEN_LOGIN,
      ])
      expect(world.log.find(e => e.call === 'refreshPublicData')!.args).toEqual([])
      expect(impl.read()).toMatchObject({ rootError: '', loginModalOpen: true, currentView: 'login', loggedIn: false })
    },
  },
  {
    name: 'ensure data: other errors become the root error',
    ctx: { adminState: loadedState(null) },
    plan: { refreshLoggedInData: [{ error: boom }] },
    drive: async (impl, _w, s) => { s.push(String(await impl.ensureLoggedInDataLoaded())) },
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['false'])
      expect(impl.read().rootError).toBe('boom')
    },
  },
  {
    name: 'ensure data: a failure while handling 401 rejects',
    ctx: { adminState: loadedState(null) },
    plan: { refreshLoggedInData: [{ error: unauthorized }], refreshPublicData: [{ error: new Error('public') }] },
    drive: (impl, _w, s) => track(s, 'ensure', impl.ensureLoggedInDataLoaded()),
    check: ({ settled }) => { expect(settled).toEqual(['ensure:err:public']) },
  },

  // --- 变更后刷新 / 统计页 ---
  {
    name: 'refresh after mutation: forced refresh',
    drive: (impl, _w, s) => track(s, 'r', impl.refreshAdminDataAfterMutation()),
    check: ({ world, impl }) => {
      expect(world.log).toMatchObject([{ call: 'refreshLoggedInData', args: [true] }])
      expect(impl.read().rootError).toBe('old')
    },
  },
  {
    name: 'refresh after mutation failure: root error, resolves',
    plan: { refreshLoggedInData: [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'r', impl.refreshAdminDataAfterMutation()),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['r:ok'])
      expect(impl.read().rootError).toBe('boom')
    },
  },
  {
    name: 'select a non-analytics tab: nothing',
    drive: (impl, _w, s) => track(s, 't', impl.selectAdminTab('settings' as AdminTab)),
    check: ({ world }) => { expect(world.log).toEqual([]) },
  },
  {
    name: 'select the analytics tab: forced refresh, failure becomes the root error',
    plan: { refreshLoggedInData: [{}, { error: boom }] },
    drive: async (impl, _w, s) => {
      await track(s, 'a', impl.selectAdminTab('analytics' as AdminTab))
      await track(s, 'b', impl.selectAdminTab('analytics' as AdminTab))
    },
    check: ({ impl, world }) => {
      expect(world.log.map(e => e.args)).toEqual([[true], [true]])
      expect(impl.read().rootError).toBe('boom')
    },
  },

  // --- 打开 / 关闭登录框 ---
  {
    name: 'open login on a public site: clears errors, loads the modal, opens it, keeps the view',
    drive: (impl, _w, s) => track(s, 'open', impl.openLogin()),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(OPEN_LOGIN)
      expect(world.log[1].state).toMatchObject({ rootError: '' })
      expect(world.log[2]).toMatchObject({ args: ['LoginModal'], state: { loginModalOpen: false } })
      expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'home' })
    },
  },
  {
    name: 'open login on a private site: switches to the login view',
    ctx: { canSeeHome: false },
    drive: (impl, _w, s) => track(s, 'open', impl.openLogin()),
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'login' }) },
  },
  {
    name: 'open login when the modal chunk fails: rejects, modal stays closed',
    plan: { ensure: [{ error: new Error('chunk') }] },
    drive: (impl, _w, s) => track(s, 'open', impl.openLogin()),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['open:err:chunk'])
      expect(impl.read()).toMatchObject({ loginModalOpen: false, rootError: '' })
    },
  },
  {
    name: 'close login on a public site: closes',
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openLogin())
      await track(s, 'close', impl.closeLogin())
    },
    check: ({ impl, world }) => {
      expect(calls(world).slice(4)).toEqual(['authView.invalidate', 'authStore.resetError', 'canSeeHome'])
      expect(impl.read()).toMatchObject({ loginModalOpen: false, currentView: 'home', rootError: '' })
    },
  },
  {
    name: 'close login on a private site: stays open on the login view',
    ctx: { canSeeHome: false },
    drive: (impl, _w, s) => track(s, 'close', impl.closeLogin()),
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'login', rootError: 'old' }) },
  },

  // --- 登录 ---
  {
    name: 'login: closes the modal, clears the error, forced refresh, goes home',
    ctx: { loggedIn: false },
    plan: { 'authStore.login': [{ effect: loggedIn }] },
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openLogin())
      await track(s, 'login', impl.login(creds))
    },
    check: ({ impl, world }) => {
      expect(calls(world).slice(4)).toEqual(['authView.invalidate', 'authStore.login', 'refreshLoggedInData', 'isAdminPath'])
      expect(world.log[5].args).toEqual(['admin', 'pw'])
      expect(world.log[6]).toMatchObject({ args: [true], state: { loginModalOpen: false, rootError: '' } })
      expect(impl.read()).toMatchObject({ currentView: 'home', loginModalOpen: false })
    },
  },
  {
    name: 'login on /admin: loads Admin, then the admin view',
    ctx: { loggedIn: false, adminPath: true },
    drive: (impl, _w, s) => track(s, 'login', impl.login(creds)),
    check: ({ impl, world }) => {
      expect(world.log.at(-1)).toMatchObject({ call: 'ensure', args: ['Admin'], state: { currentView: 'home' } })
      expect(impl.read().currentView).toBe('admin')
    },
  },
  {
    name: 'login failure is swallowed (authStore records it): modal stays, no refresh',
    ctx: { loggedIn: false },
    plan: { 'authStore.login': [{ error: new Error('bad credentials') }] },
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openLogin())
      await track(s, 'login', impl.login(creds))
    },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['open:ok', 'login:ok'])
      expect(calls(world)).not.toContain('refreshLoggedInData')
      expect(impl.read()).toMatchObject({ loginModalOpen: true })
    },
  },
  {
    name: 'login when the refresh fails: swallowed after the modal closed, view unchanged',
    ctx: { loggedIn: false, adminPath: true },
    plan: { refreshLoggedInData: [{ error: boom }] },
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openLogin())
      await track(s, 'login', impl.login(creds))
    },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['open:ok', 'login:ok'])
      expect(calls(world)).not.toContain('isAdminPath')
      expect(impl.read()).toMatchObject({ loginModalOpen: false, rootError: '', currentView: 'home' })
    },
  },

  // --- 登出 ---
  {
    name: 'logout on a public site: resets editors in order, restores config, refreshes public data, home without modal',
    plan: { 'authStore.logout': [{ value: { revoked: true }, effect: loggedOut }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual([
        'authView.begin', 'readAdminState', 'authStore.logout', 'isLoggedIn',
        'resetCategories', 'resetSettings', 'resetBookmarks', 'resetAdminData', 'clearCachedAdminData', 'isLoggedIn',
        'applyConfigFromSettings', 'refreshPublicData', 'getPublicMode', 'isLoggedIn', 'isLoggedIn',
      ])
      expect(world.log[1].state).toMatchObject({ rootError: '' })
      expect(world.log.find(e => e.call === 'applyConfigFromSettings')!.args).toEqual([settingsA])
      expect(impl.read()).toMatchObject({ loginModalOpen: false, currentView: 'home' })
    },
  },
  {
    name: 'logout on a private site: loads the login modal, then opens it on the login view',
    ctx: { publicMode: false },
    plan: { 'authStore.logout': [{ value: { revoked: true }, effect: loggedOut }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'ensure')).toMatchObject({ args: ['LoginModal'], state: { loginModalOpen: false } })
      expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'login', loggedIn: false })
    },
  },
  {
    name: 'logout whose token could not be revoked: toast after the view switch',
    ctx: { publicMode: false },
    plan: { 'authStore.logout': [{ value: { revoked: false, reason: 'store_unavailable' }, effect: loggedOut }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ world }) => {
      const toast = world.log.at(-1)!
      expect(toast.call).toBe('toast')
      expect(toast.args).toEqual([logoutRevocationWarning({ revoked: false, reason: 'store_unavailable' } as LogoutResp), 'error', { duration: 12000 }])
      expect(toast.state).toMatchObject({ currentView: 'login', loginModalOpen: true })
    },
  },
  {
    name: 'logout that leaves the session in place: nothing reset, view unchanged, warning still shown',
    plan: { 'authStore.logout': [{ value: { revoked: false, reason: 'store_unconfigured' } }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(['authView.begin', 'readAdminState', 'authStore.logout', 'isLoggedIn', 'getPublicMode', 'isLoggedIn', 'toast'])
      expect(impl.read()).toMatchObject({ currentView: 'home', rootError: '' })
    },
  },
  {
    name: 'logout: logged in again while clearing the cache -> no config restore or public refresh',
    plan: { 'authStore.logout': [{ value: null, effect: loggedOut }], clearCachedAdminData: [{ effect: loggedIn }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ world }) => {
      expect(calls(world)).not.toContain('applyConfigFromSettings')
      expect(calls(world)).not.toContain('refreshPublicData')
    },
  },
  {
    name: 'logout without previous settings: no config restore',
    ctx: { adminState: loadedState(null) },
    plan: { 'authStore.logout': [{ effect: loggedOut }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ world }) => {
      expect(calls(world)).not.toContain('applyConfigFromSettings')
      expect(calls(world)).toContain('refreshPublicData')
    },
  },
  {
    name: 'logout superseded by opening the login modal while revoking: view left to the newer action',
    ctx: { publicMode: false, canSeeHome: false },
    plan: { 'authStore.logout': [{ defer: 'out' }] },
    drive: async (impl, w, s) => {
      const p = track(s, 'logout', impl.logout())
      await flush()
      await track(s, 'open', impl.openLogin())
      w.ctx.loggedIn = false
      await w.release('out', { value: { revoked: true } })
      await p
    },
    check: ({ impl, world }) => {
      expect(calls(world).filter(c => c === 'ensure')).toHaveLength(1)
      expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'login' })
    },
  },
  {
    name: 'logout superseded by forgot-password while loading the login modal: no view switch',
    ctx: { publicMode: false },
    plan: { 'authStore.logout': [{ effect: loggedOut }], ensure: [{ defer: 'modal' }] },
    drive: async (impl, w, s) => {
      const p = track(s, 'logout', impl.logout())
      await flush()
      impl.forgotPassword()
      await w.release('modal')
      await p
    },
    check: ({ impl, world }) => {
      expect(calls(world)).toContain('enterRecover')
      expect(impl.read()).toMatchObject({ loginModalOpen: false, currentView: 'home' })
    },
  },
  {
    name: 'logout failure: root error',
    plan: { 'authStore.logout': [{ effect: loggedOut }], refreshPublicData: [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'logout', impl.logout()),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['logout:ok'])
      expect(impl.read().rootError).toBe('boom')
    },
  },
  {
    name: 'logout failure after being superseded: no root error',
    plan: { 'authStore.logout': [{ error: boom, defer: 'out' }] },
    drive: async (impl, w, s) => {
      const p = track(s, 'logout', impl.logout())
      await flush()
      await track(s, 'close', impl.closeLogin())
      await w.release('out', { error: boom })
      await p
    },
    check: ({ impl }) => { expect(impl.read().rootError).toBe('') },
  },

  // --- 进入后台 ---
  {
    name: 'switch to admin while logged out: opens login',
    ctx: { loggedIn: false },
    drive: (impl, _w, s) => track(s, 'admin', impl.switchToAdmin()),
    check: ({ world }) => { expect(calls(world)).toEqual(['isLoggedIn', ...OPEN_LOGIN]) },
  },
  {
    name: 'switch to admin: data ready -> loads Admin, replaces the path, admin view',
    drive: (impl, _w, s) => track(s, 'admin', impl.switchToAdmin()),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(['isLoggedIn', 'isLoggedIn', 'readAdminState', 'ensure', 'replacePath'])
      expect(world.log.at(-1)).toMatchObject({ args: ['/admin'], state: { currentView: 'home' } })
      expect(impl.read().currentView).toBe('admin')
    },
  },
  {
    name: 'switch to admin when the data cannot be loaded: stays put',
    ctx: { adminState: loadedState(null) },
    plan: { refreshLoggedInData: [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'admin', impl.switchToAdmin()),
    check: ({ impl, world }) => {
      expect(calls(world)).not.toContain('ensure')
      expect(impl.read()).toMatchObject({ currentView: 'home', rootError: 'boom' })
    },
  },
  {
    name: 'switch to admin when the session expired: login opened, no admin',
    ctx: { adminState: loadedState(null) },
    plan: { refreshLoggedInData: [{ error: unauthorized }] },
    drive: (impl, _w, s) => track(s, 'admin', impl.switchToAdmin()),
    check: ({ impl, world }) => {
      expect(calls(world).filter(c => c === 'ensure')).toHaveLength(1)
      expect(impl.read()).toMatchObject({ loginModalOpen: true, currentView: 'home' })
    },
  },
  {
    name: 'switch to admin when the Admin chunk fails: rejects',
    plan: { ensure: [{ error: new Error('chunk') }] },
    drive: (impl, _w, s) => track(s, 'admin', impl.switchToAdmin()),
    check: ({ settled, world }) => {
      expect(settled).toEqual(['admin:err:chunk'])
      expect(calls(world)).not.toContain('replacePath')
    },
  },

  // --- 忘记密码 / 兑现时机 ---
  {
    name: 'forgot password: invalidates the auth view, closes the modal, enters recovery',
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openLogin())
      impl.forgotPassword()
    },
    check: ({ impl, world }) => {
      expect(calls(world).slice(4)).toEqual(['authView.invalidate', 'enterRecover'])
      expect(world.log.at(-1)!.state).toMatchObject({ loginModalOpen: false })
      expect(impl.read().loginModalOpen).toBe(false)
    },
  },
  {
    name: 'settle order across the async wrappers matches the original handlers',
    ctx: { loggedIn: false },
    drive: async (impl, _w, s) => {
      await Promise.all([
        track(s, 'admin', impl.switchToAdmin()),
        track(s, 'open', impl.openLogin()),
        track(s, 'login', impl.login(creds)),
        track(s, 'close', impl.closeLogin()),
        track(s, 'tab', impl.selectAdminTab('analytics' as AdminTab)),
        track(s, 'refresh', impl.refreshAdminDataAfterMutation()),
        track(s, 'ensure', impl.ensureLoggedInDataLoaded()),
      ])
    },
  },
]

function runScenario(sc: Scenario, attach: (w: World) => Impl): Promise<Result> {
  const world = new World(sc.plan ?? {}, sc.ctx)
  activeWorld = world
  const impl = attach(world)
  const settled: string[] = []
  return sc.drive(impl, world, settled).then(async () => {
    await flush()
    activeWorld = null
    return { world, impl, settled }
  })
}

describe('app auth controller', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      const ours = await runScenario(sc, attachController)
      const legacy = await runScenario(sc, attachLegacy)

      expect(ours.world.log).toEqual(legacy.world.log)
      expect(ours.impl.read()).toEqual(legacy.impl.read())
      expect(ours.settled).toEqual(legacy.settled)
      expect(ours.world.gates.size).toBe(0)
      sc.check?.(ours)
    })
  }

  it('App wires the auth handlers through the controller and forwards the shared ones', () => {
    const app = readFileSync('src/App.svelte', 'utf8')
    expect(app).toContain('createAuthController(')
    expect(app).toContain('onSubmit={authController.login}')
    expect(app).toContain('onCancel={authController.closeLogin}')
    expect(app).toContain('onForgotPassword={authController.forgotPassword}')
    expect(app).toContain('onSwitchToAdmin={authController.switchToAdmin}')
    expect(app).toContain('onSelectTab={authController.selectAdminTab}')
    expect(app.match(/onLogout=\{authController\.logout\}/g)).toHaveLength(2)
    expect(app.match(/onOpenLogin=\{authController\.openLogin\}/g)).toHaveLength(2)
    expect(app).toContain('openLogin: () => authController.openLogin()')
    expect(app).toContain('ensureLoggedInDataLoaded: () => authController.ensureLoggedInDataLoaded()')
    expect(app).toContain('refreshAdminDataAfterMutation: () => authController.refreshAdminDataAfterMutation()')
    expect(app).not.toMatch(/function (handle(OpenLogin|CloseLogin|Login|Logout|SwitchToAdmin|ForgotPassword|AdminTabChange)|ensureLoggedInDataLoaded|refreshAdminDataAfterMutation)\b/)
  })
})

// ---------------------------------------------------------------------------
// legacy：逐字复刻拆分前 App.svelte（HEAD a4a2c56）的认证与登录态数据加载代码。
// 仅做机械替换：App 作用域变量 → `app.xxx`、`canSeeHome` → canSeeHome()，模块级依赖 → 世界替身
// （authStore.login / logout / resetError / setSession、lazyComponents.ensure、refreshLoggedInData / refreshPublicData、
// clearCachedAdminData、applyConfigFromSettings、isLoggedIn / isAdminPath → 同名替身；`get(adminStore)` →
// readAdminState()，`get(configStore).data?.public_mode` → getPublicMode()，`adminStore.reset()` → resetAdminData()，
// `categoryController.reset()` / `settingsController.reset()` / `bookmarkController.reset()` → resetCategories /
// resetSettings / resetBookmarks，`replaceBrowserPath` → replacePath，`boot.enterRecover()` → enterRecover()），
// 控制流与语句顺序不变。
// ---------------------------------------------------------------------------

function attachLegacy(w: World): Impl {
  const app = newAppVars()
  const d = doubles(w, app)
  const authViewIntent = d.authViewIntent
  const authStore = { ...d.authStore, setSession: d.setSession }
  const lazyComponents = { ensure: d.ensureLazyComponent }
  const adminStore = { reset: d.resetAdminData }
  const categoryController = { reset: d.resetCategories }
  const settingsController = { reset: d.resetSettings }
  const bookmarkController = { reset: d.resetBookmarks }
  const boot = { enterRecover: d.enterRecover }
  const replaceBrowserPath = d.replacePath
  const canSeeHome = d.getCanSeeHome
  const {
    isLoggedIn,
    isAdminPath,
    refreshLoggedInData,
    refreshPublicData,
    clearCachedAdminData,
    applyConfigFromSettings,
  } = d

  async function ensureLoggedInDataLoaded(): Promise<boolean> {
    if (!isLoggedIn()) return false

    const current = d.readAdminState()
    if (current.loaded && current.data.settings) {
      return true
    }

    try {
      await refreshLoggedInData()
      return isLoggedIn() && d.readAdminState().loaded
    } catch (error) {
      if (isUnauthorizedError(error)) {
        authStore.setSession(null)
        adminStore.reset()
        await clearCachedAdminData()
        await refreshPublicData()
        await handleOpenLogin()
        return false
      }

      app.rootError = getErrorMessage(error)
      return false
    }
  }

  async function refreshAdminDataAfterMutation(): Promise<void> {
    try {
      await refreshLoggedInData(true)
    } catch (error) {
      // 写入已经成功；刷新失败时保留本地即时结果，并提示用户稍后重试。
      app.rootError = getErrorMessage(error)
    }
  }

  async function handleAdminTabChange(tab: AdminTab): Promise<void> {
    if (tab !== 'analytics') return

    try {
      await refreshLoggedInData(true)
    } catch (error) {
      app.rootError = getErrorMessage(error)
    }
  }

  async function openLoginUseCase(): Promise<void> {
    authViewIntent.invalidate()
    app.rootError = ''
    authStore.resetError()
    await lazyComponents.ensure('LoginModal')
    app.loginModalOpen = true
    if (!canSeeHome()) app.currentView = 'login'
  }
  async function handleOpenLogin(): Promise<void> {
    await openLoginUseCase()
  }

  async function handleCloseLogin(): Promise<void> {
    authViewIntent.invalidate()
    authStore.resetError()
    if (!canSeeHome()) {
      app.loginModalOpen = true
      app.currentView = 'login'
      return
    }

    app.loginModalOpen = false
  }

  async function handleSwitchToAdmin(): Promise<void> {
    await openAdminUseCase()
  }

  async function completeLoginUseCase(payload: { username: string; password: string }): Promise<void> {
    authViewIntent.invalidate()
    await authStore.login(payload.username, payload.password)
    app.loginModalOpen = false
    app.rootError = ''
    await refreshLoggedInData(true)
    if (isAdminPath()) {
      await lazyComponents.ensure('Admin')
      app.currentView = 'admin'
      return
    }
    app.currentView = 'home'
  }
  async function handleLogin(payload: { username: string; password: string }): Promise<void> {
    try {
      await completeLoginUseCase(payload)
    } catch {
      // authStore 已经记录错误
    }
  }

  async function completeLogoutUseCase(previousSettings: Settings | null): Promise<string | null> {
    const revocationWarning = logoutRevocationWarning(await authStore.logout())
    if (isLoggedIn()) return revocationWarning
    categoryController.reset()
    settingsController.reset()
    bookmarkController.reset()
    adminStore.reset()
    await clearCachedAdminData()
    if (isLoggedIn()) return revocationWarning
    if (previousSettings) {
      applyConfigFromSettings(previousSettings)
    }
    await refreshPublicData()
    return revocationWarning
  }

  async function handleLogout(): Promise<void> {
    const viewIsCurrent = authViewIntent.begin()
    app.rootError = ''
    const previousSettings = d.readAdminState().data.settings

    try {
      const revocationWarning = await completeLogoutUseCase(previousSettings)

      const homeGate = createHomeGateState({
        publicMode: d.getPublicMode(),
        authenticated: false,
      })
      if (viewIsCurrent() && !isLoggedIn()) {
        if (homeGate.loginModalOpen) await lazyComponents.ensure('LoginModal')
        // Lazy loading can yield to another login/recovery action as well.
        if (viewIsCurrent() && !isLoggedIn()) {
          app.loginModalOpen = homeGate.loginModalOpen
          app.currentView = homeGate.view
        }
      }
      // 视图先切换，确保全局 Toast 不被登出后的页面切换影响。
      if (revocationWarning) {
        toastStore.addToast(revocationWarning, 'error', { duration: 12000 })
      }
    } catch (error) {
      if (viewIsCurrent()) app.rootError = getErrorMessage(error)
    }
  }

  async function openAdminUseCase(): Promise<void> {
    if (!isLoggedIn()) {
      await handleOpenLogin()
      return
    }

    if (!await ensureLoggedInDataLoaded()) {
      return
    }

    await lazyComponents.ensure('Admin')
    replaceBrowserPath('/admin')
    app.currentView = 'admin'
  }
  function handleForgotPassword(): void {
    authViewIntent.invalidate()
    // 忘记密码是登录态的子流程，按模态语义处理：不改 URL，避免 pushState 制造一个没有
    // popstate 监听的历史项（后退键会让 URL 与视图错位）。直达 /recover 仍由 onMount 处理。
    app.loginModalOpen = false
    boot.enterRecover()
  }

  const impl: Impl = {
    openLogin: handleOpenLogin,
    closeLogin: handleCloseLogin,
    switchToAdmin: handleSwitchToAdmin,
    login: handleLogin,
    logout: handleLogout,
    forgotPassword: handleForgotPassword,
    ensureLoggedInDataLoaded,
    refreshAdminDataAfterMutation,
    selectAdminTab: handleAdminTabChange,
    read: () => ({ ...app, loggedIn: w.ctx.loggedIn }),
  }
  w.impl = impl
  return impl
}
