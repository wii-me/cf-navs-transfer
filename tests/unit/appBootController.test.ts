import { describe, expect, it } from 'vitest'
import { ErrCode, type InstallReq, type InstallStatusResp, type LoginResp } from '../../shared/types'
import { ApiError, getErrorMessage, isUnauthorizedError } from '../../src/lib/api'
import {
  createAppBootController,
  getBrowserInstallHintStorage,
  type AppBootDeps,
  type InstallCredentials,
} from '../../src/lib/appBootController'
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
  getInstallViewState,
  toInstallScreenState,
  type InstallScreenState,
} from '../../src/lib/appInstall'
import { createHomeGateState, shouldRevealHomeFromLocalSnapshot, type AppView } from '../../src/lib/appNavigation'

// 代码审查三轮第 12 项：App.svelte 拆分第 6 步。
// 每个用例在同一份「世界」脚本下分别驱动新控制器与逐字复刻的原 App 实现（见文件末尾 legacy），
// 断言两者的依赖调用序列（每次调用时的完整状态快照）、最终状态与 promise 结果完全一致，
// 再对控制器的结果做语义断言。

// ---------------------------------------------------------------------------
// 测试世界：可编排的依赖替身
// ---------------------------------------------------------------------------

type Outcome = { value?: unknown; error?: unknown; defer?: string; effect?: (w: World) => void }

interface Plan {
  pathname?: string | null
  hint?: boolean
  storageUnavailable?: boolean
  loggedIn?: boolean
  publicMode?: boolean | null
  status?: Outcome[]
  install?: Outcome[]
  initializeAuth?: Outcome[]
  refreshLoggedIn?: Outcome[]
  refreshPublic?: Outcome[]
  ensure?: Outcome[]
}

interface Snapshot {
  booting: boolean
  installState: InstallScreenState
  recoverActive: boolean
  rootError: string
  currentView: AppView
  loginModalOpen: boolean
  hint: boolean
  pathname: string | null
  loggedIn: boolean
}

interface LogEntry { call: string; args: unknown[]; state: Snapshot }

// 两种实现共同暴露给驱动脚本的入口（对应 App 里的处理器与 dataService 回调）。
interface Impl {
  start(): boolean
  initializeApp(installStatusKnown?: unknown): Promise<void>
  /** 安装页「重新检查」按钮；参数模拟 on:click 传入的事件对象。 */
  retryInstallStatus(event?: unknown): Promise<void>
  install(value: InstallCredentials): Promise<void>
  recovered(session: LoginResp): Promise<void>
  goInstall(): void
  cancelRecover(): void
  enterRecover(): void
  onRootError(message: string, error: unknown): void
  onLocalSnapshotRestored(): void
  /** App 其它用例（如打开登录框）清空 rootError。 */
  clearRootError(): void
  read(): Omit<Snapshot, 'hint' | 'pathname' | 'loggedIn'>
}

class World {
  log: LogEntry[] = []
  pathname: string | null
  storage: Map<string, string> | null
  loggedIn: boolean
  publicMode: boolean | null
  gates = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  impl!: Impl
  private queues: Required<Omit<Plan, 'pathname' | 'hint' | 'storageUnavailable' | 'loggedIn' | 'publicMode'>>

  constructor(plan: Plan) {
    this.pathname = plan.pathname === undefined ? '/' : plan.pathname
    this.storage = plan.storageUnavailable ? null : new Map(plan.hint ? [['cf-navs:installed', '1']] : [])
    this.loggedIn = plan.loggedIn ?? false
    this.publicMode = plan.publicMode === undefined ? true : plan.publicMode
    this.queues = {
      status: [...(plan.status ?? [])],
      install: [...(plan.install ?? [])],
      initializeAuth: [...(plan.initializeAuth ?? [])],
      refreshLoggedIn: [...(plan.refreshLoggedIn ?? [])],
      refreshPublic: [...(plan.refreshPublic ?? [])],
      ensure: [...(plan.ensure ?? [])],
    }
  }

  snapshot(): Snapshot {
    return {
      ...this.impl.read(),
      hint: this.storage?.get('cf-navs:installed') === '1',
      pathname: this.pathname,
      loggedIn: this.loggedIn,
    }
  }

  record(call: string, ...args: unknown[]): void {
    this.log.push({ call, args, state: structuredClone(this.snapshot()) })
  }

  run(queue: keyof World['queues'], call: string, args: unknown[]): Promise<unknown> {
    this.record(call, ...args)
    const outcome = this.queues[queue].shift() ?? {}
    const settle = (o: Outcome): Promise<unknown> => {
      o.effect?.(this)
      return 'error' in o ? Promise.reject(o.error) : Promise.resolve(o.value)
    }
    if (outcome.defer) {
      return new Promise((resolve, reject) => {
        this.gates.set(outcome.defer!, { resolve, reject })
      }).then((o) => settle(o as Outcome))
    }
    return settle(outcome)
  }

  /** 放行一个延迟中的调用，并让后续微任务全部跑完。 */
  async release(gate: string, outcome: Outcome = {}): Promise<void> {
    const entry = this.gates.get(gate)
    if (!entry) throw new Error(`no gate ${gate}`)
    this.gates.delete(gate)
    entry.resolve(outcome)
    await flush()
  }

  storageApi(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    const map = this.storage
    if (!map) return null
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        this.record('storage.setItem', key, value)
        map.set(key, value)
      },
      removeItem: (key) => {
        this.record('storage.removeItem', key)
        map.delete(key)
      },
    }
  }

  replacePath(pathname: string): void {
    this.record('replacePath', pathname)
    // 与 replaceBrowserPath 一致：没有 window 或路径相同时不动。
    if (this.pathname === null || this.pathname === pathname) return
    this.pathname = pathname
  }

  setSession(session: LoginResp | null): void {
    this.record('setSession', session)
    this.loggedIn = Boolean(session)
  }

  installApi = {
    status: () => this.run('status', 'status', []) as Promise<InstallStatusResp>,
    install: (payload: InstallReq, setupToken: string) =>
      this.run('install', 'install', [payload, setupToken]) as Promise<LoginResp>,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// 新控制器接到世界上（接线方式与 App.svelte 相同）
// ---------------------------------------------------------------------------

function attachController(w: World): Impl {
  let rootError = ''
  let currentView: AppView = 'home'
  let loginModalOpen = false
  const deps: AppBootDeps = {
    onChange: () => {},
    installApi: w.installApi,
    getInstallHintStorage: () => w.storageApi(),
    getPathname: () => w.pathname,
    replacePath: (p) => w.replacePath(p),
    clearCachedAdminData: async () => { w.record('clearCachedAdminData') },
    clearCachedPublicData: async () => { w.record('clearCachedPublicData') },
    setSession: (s) => w.setSession(s),
    initializeAuth: () => w.run('initializeAuth', 'initializeAuth', []).then(() => undefined),
    resetAdminData: () => w.record('resetAdminData'),
    isLoggedIn: () => w.loggedIn,
    refreshLoggedInData: () => w.run('refreshLoggedIn', 'refreshLoggedInData', []),
    refreshPublicData: (progressive) => w.run('refreshPublic', 'refreshPublicData', progressive === undefined ? [] : [progressive]),
    getPublicMode: () => w.publicMode,
    isAdminPath: () => w.pathname === '/admin' || w.pathname === '/admin/',
    ensureLazyComponent: (name) => w.run('ensure', 'ensure', [name]),
    getRootError: () => rootError,
    setRootError: (m) => { rootError = m },
    setLoginModalOpen: (o) => { loginModalOpen = o },
    setCurrentView: (v) => { currentView = v },
  }
  const boot = createAppBootController(deps)
  const impl: Impl = {
    start: () => boot.start(),
    initializeApp: (x) => boot.initializeApp(x),
    // 与 App 接线一致：onRetryStatus={boot.retryInstallStatus}，Install 的 on:click 会传入事件对象。
    retryInstallStatus: (event) => (boot.retryInstallStatus as (event?: unknown) => Promise<void>)(event),
    install: (v) => boot.install(v),
    recovered: (s) => boot.recovered(s),
    goInstall: () => boot.goInstall(),
    cancelRecover: () => boot.cancelRecover(),
    enterRecover: () => boot.enterRecover(),
    onRootError: (message, error) => {
      rootError = message
      boot.recordDataError(error)
    },
    onLocalSnapshotRestored: () => boot.revealHomeFromCurrentData(),
    clearRootError: () => { rootError = '' },
    read: () => ({ ...boot.getState(), rootError, currentView, loginModalOpen }),
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
  plan: Plan
  drive: (impl: Impl, w: World, settled: string[]) => Promise<void>
  check?: (r: Result) => void
}

function track(settled: string[], label: string, p: Promise<unknown>): Promise<void> {
  return p.then(
    () => { settled.push(`${label}:ok`) },
    (e) => { settled.push(`${label}:err:${getErrorMessage(e)}`) },
  )
}

const needsInstall: InstallStatusResp = { state: 'needs_install', schema_version: null, setup_token_configured: true }
const configRequired: InstallStatusResp = { state: 'configuration_required', reason: 'setup_token_missing', schema_version: null }
const bindingsMissing: InstallStatusResp = { state: 'bindings_missing', missing: ['DB'] }
const unavailable: InstallStatusResp = { state: 'unavailable', reason: 'database_unreachable' }
const installed: InstallStatusResp = { state: 'installed', schema_version: 3 }
const session = { token: 't', user: { username: 'admin' } } as unknown as LoginResp
const creds: InstallCredentials = { setupToken: 'tok', username: 'admin', password: 'pw-123456' }
const serverError = new ApiError('服务器错误', { status: 500, code: ErrCode.SERVER_ERROR })
const networkError = new ApiError('网络不可用', { status: 0, code: ErrCode.SERVER_ERROR })
const unauthorized = new ApiError('未登录', { status: 401, code: ErrCode.UNAUTHORIZED })
const publicFailure = (error: unknown): Outcome => ({ effect: (w) => w.impl.onRootError(getErrorMessage(error), error) })

const boot = (impl: Impl, settled: string[]) => track(settled, 'start', (async () => { settled.push(`start:${impl.start()}`) })())
const init = (impl: Impl, settled: string[], label = 'init', arg?: unknown) =>
  track(settled, label, arg === undefined ? impl.initializeApp() : impl.initializeApp(arg))

const scenarios: Scenario[] = [
  // --- 安装探测 ---
  {
    name: 'fresh browser, needs install: shows the install screen',
    plan: { status: [{ value: needsInstall }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(impl.read()).toMatchObject({ booting: false, installState: toInstallScreenState(needsInstall as never) })
      expect(world.pathname).toBe('/install')
      expect(world.log.map(e => e.call)).toEqual(['status', 'storage.removeItem', 'replacePath'])
    },
  },
  ...[configRequired, bindingsMissing, unavailable].map((status): Scenario => ({
    name: `fresh browser, ${status.state}: shows guidance`,
    plan: { status: [{ value: status }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'pending', status } })
    },
  })),
  {
    name: 'installed hint on /: skips the probe entirely',
    plan: { hint: true, refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.some(e => e.call === 'status')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home', installState: { type: 'checking' } })
    },
  },
  {
    name: 'installed hint on /install with transient outage: falls back to the app',
    plan: { hint: true, pathname: '/install', status: [{ value: unavailable }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.pathname).toBe('/')
      expect(world.storage?.get('cf-navs:installed')).toBe('1')
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
    },
  },
  {
    name: 'installed hint on /install with probe failure: falls back to the app',
    plan: { hint: true, pathname: '/install', status: [{ error: new Error('offline') }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.pathname).toBe('/')
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
    },
  },
  {
    name: 'no hint, probe fails: status error screen',
    plan: { status: [{ error: new Error('boom') }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'status_error', message: 'boom' } })
    },
  },
  {
    name: 'no hint, probe fails without message: generic status error',
    plan: { status: [{ error: 'weird' }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read().installState).toEqual({ type: 'status_error', message: normalizeInstallError('weird') })
    },
  },
  {
    name: 'installed on /install: remembers and leaves the install path',
    plan: { pathname: '/install', status: [{ value: installed }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.pathname).toBe('/')
      expect(world.storage?.get('cf-navs:installed')).toBe('1')
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
    },
  },
  {
    name: 'no window: probes from "/" and never touches the path',
    plan: { pathname: null, storageUnavailable: true, status: [{ value: installed }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.pathname).toBeNull()
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
    },
  },
  {
    name: 'storage unavailable with needs_install',
    plan: { storageUnavailable: true, status: [{ value: needsInstall }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => { expect(impl.read().installState.type).toBe('pending') },
  },

  // --- 数据加载 ---
  {
    name: 'anonymous + public site: home',
    plan: { hint: true, refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'refreshPublicData')?.args).toEqual([true])
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home', loginModalOpen: false })
    },
  },
  {
    name: 'anonymous + private site: login gate after LoginModal loads',
    plan: { hint: true, publicMode: false, refreshPublic: [{}], ensure: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.filter(e => e.call === 'ensure').map(e => e.args)).toEqual([['LoginModal']])
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'login', loginModalOpen: true })
    },
  },
  {
    name: 'logged in on /admin: loads Admin and opens it',
    plan: { hint: true, pathname: '/admin', loggedIn: true, refreshLoggedIn: [{}], ensure: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'refreshLoggedInData')?.args).toEqual([])
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'admin', loginModalOpen: false })
    },
  },
  {
    name: 'anonymous on /admin of a private site: login gate, not admin',
    plan: { hint: true, pathname: '/admin', publicMode: false, refreshPublic: [{}], ensure: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ currentView: 'login', loginModalOpen: true }) },
  },
  {
    name: 'logged in, private site, /admin: LoginModal not needed, admin wins',
    plan: { hint: true, pathname: '/admin', publicMode: false, loggedIn: true, refreshLoggedIn: [{}], ensure: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ currentView: 'admin', loginModalOpen: false }) },
  },
  {
    name: 'auth initialization fails: error shown, boot continues',
    plan: { hint: true, initializeAuth: [{ error: new Error('auth down') }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, rootError: 'auth down', currentView: 'home' })
    },
  },
  {
    name: 'expired session: clears it and falls back to public data',
    plan: { hint: true, loggedIn: true, refreshLoggedIn: [{ error: unauthorized }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.map(e => e.call)).toEqual([
        'initializeAuth', 'resetAdminData', 'refreshLoggedInData',
        'setSession', 'resetAdminData', 'clearCachedAdminData', 'refreshPublicData',
      ])
      expect(world.log.at(-1)?.args).toEqual([])
      expect(impl.read()).toMatchObject({ booting: false, rootError: '', currentView: 'home' })
    },
  },
  {
    name: 'logged-in server error, recheck finds the site uninstalled: install screen',
    plan: { hint: true, loggedIn: true, refreshLoggedIn: [{ error: serverError }], status: [{ value: needsInstall }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.some(e => e.call === 'refreshPublicData')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'pending' }, rootError: '' })
      expect(world.storage?.has('cf-navs:installed')).toBe(false)
    },
  },
  {
    name: 'logged-in server error, recheck says installed: error shown, public data loaded',
    plan: { hint: true, loggedIn: true, refreshLoggedIn: [{ error: serverError }], status: [{ value: installed }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, rootError: '服务器错误', currentView: 'home', installState: { type: 'checking' } })
    },
  },
  {
    name: 'logged-in server error, recheck probe fails with hint: treated as installed',
    plan: { hint: true, loggedIn: true, refreshLoggedIn: [{ error: serverError }], status: [{ error: new Error('x') }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ booting: false, rootError: '服务器错误' }) },
  },
  {
    name: 'logged-in network error: no recheck',
    plan: { hint: true, loggedIn: true, refreshLoggedIn: [{ error: networkError }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.some(e => e.call === 'status')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, rootError: '网络不可用' })
    },
  },
  {
    name: 'anonymous public load reports a server error, recheck finds uninstalled',
    plan: { hint: true, refreshPublic: [publicFailure(serverError)], status: [{ value: needsInstall }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'pending' }, rootError: '服务器错误' })
    },
  },
  {
    name: 'anonymous public load reports a server error, recheck says installed',
    plan: { hint: true, refreshPublic: [publicFailure(serverError)], status: [{ value: installed }] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home', rootError: '服务器错误' })
    },
  },
  {
    name: 'anonymous public load reports a network error: no recheck',
    plan: { hint: true, refreshPublic: [publicFailure(networkError)] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ world, impl }) => {
      expect(world.log.some(e => e.call === 'status')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, rootError: '网络不可用' })
    },
  },
  {
    name: 'auth error message + server error with no data error recorded: recheck sees null error',
    plan: { hint: true, initializeAuth: [{ error: serverError }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ world, impl }) => {
      // rootError 非空但 lastDataError 为 null：不复核。
      expect(world.log.some(e => e.call === 'status')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, rootError: '服务器错误' })
    },
  },
  {
    name: 'stale data error from a previous boot is cleared on re-initialize',
    plan: { hint: true, refreshPublic: [publicFailure(serverError), {}], status: [{ value: installed }] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      // 再次初始化：rootError 与 lastDataError 都被清空，第二次公开加载成功，不再复核。
      await init(impl, s, 'retry'); await flush()
    },
    check: ({ world, impl }) => {
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(1)
      expect(impl.read()).toMatchObject({ booting: false, rootError: '' })
    },
  },
  {
    name: 'LoginModal chunk fails during boot: initializeApp rejects and boot stays on the splash',
    plan: { hint: true, publicMode: false, refreshPublic: [{}], ensure: [{ error: new Error('chunk') }] },
    drive: async (impl, _w, s) => { await init(impl, s); await flush() },
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['init:err:chunk'])
      expect(impl.read()).toMatchObject({ booting: true, loginModalOpen: false })
    },
  },
  {
    name: 'Admin chunk fails during boot: login modal state already applied, still booting',
    plan: { hint: true, pathname: '/admin', loggedIn: true, refreshLoggedIn: [{}], ensure: [{ error: new Error('admin chunk') }] },
    drive: async (impl, _w, s) => { await init(impl, s); await flush() },
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['init:err:admin chunk'])
      expect(impl.read()).toMatchObject({ booting: true, currentView: 'home', loginModalOpen: false })
    },
  },

  // --- 安装 ---
  {
    name: 'install succeeds: caches cleared, session stored, boot resumes without probing',
    plan: { status: [{ value: needsInstall }], install: [{ value: session }], loggedIn: false, refreshLoggedIn: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'install', impl.install(creds)); await flush()
    },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['start:true', 'start:ok', 'install:ok'])
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(1)
      expect(world.log.find(e => e.call === 'install')?.args).toEqual([{ username: 'admin', password: 'pw-123456' }, 'tok'])
      expect(world.log.find(e => e.call === 'install')?.state.installState.type).toBe('installing')
      expect(world.pathname).toBe('/')
      expect(world.storage?.get('cf-navs:installed')).toBe('1')
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'checking' }, currentView: 'home' })
    },
  },
  {
    name: 'install request fails but the installation committed: enters the app without a session',
    plan: { status: [{ value: needsInstall }, { value: installed }], install: [{ error: new Error('timeout') }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'install', impl.install(creds)); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'setSession')?.args).toEqual([null])
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'checking' } })
    },
  },
  {
    name: 'install fails and not committed: back to pending with the error',
    plan: { status: [{ value: needsInstall }, { value: needsInstall }], install: [{ error: new Error('bad token') }] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'install', impl.install(creds)); await flush()
    },
    check: ({ impl }) => {
      expect(impl.read().installState).toEqual({ type: 'pending', status: needsInstall, error: 'bad token' })
    },
  },
  {
    name: 'install fails and the commit check also fails: pending with the original error',
    plan: { status: [{ value: needsInstall }, { error: new Error('down') }], install: [{ error: new Error('bad token') }] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'install', impl.install(creds)); await flush()
    },
    check: ({ impl }) => {
      expect(impl.read().installState).toMatchObject({ type: 'pending', error: 'bad token' })
    },
  },
  {
    name: 'install is ignored unless pending needs_install',
    plan: { status: [{ value: configRequired }] },
    drive: async (impl, _w, s) => {
      await track(s, 'early', impl.install(creds))
      await boot(impl, s); await flush()
      await track(s, 'install', impl.install(creds)); await flush()
    },
    check: ({ world }) => { expect(world.log.some(e => e.call === 'install')).toBe(false) },
  },
  {
    name: 'double submit while installing is ignored',
    plan: { status: [{ value: needsInstall }], install: [{ defer: 'install', value: session }], refreshLoggedIn: [{}] },
    drive: async (impl, w, s) => {
      await boot(impl, s); await flush()
      const first = track(s, 'install1', impl.install(creds))
      await track(s, 'install2', impl.install(creds))
      await w.release('install', { value: session })
      await first
    },
    check: ({ world, settled }) => {
      expect(world.log.filter(e => e.call === 'install')).toHaveLength(1)
      expect(settled).toEqual(['start:true', 'start:ok', 'install2:ok', 'install1:ok'])
    },
  },

  // --- 重试 ---
  {
    name: 'retry after a status error re-probes and recovers',
    plan: { status: [{ error: new Error('boom') }, { value: installed }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await init(impl, s, 'retry'); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(2)
      expect(world.log.filter(e => e.call === 'status')[1].state).toMatchObject({ booting: true, installState: { type: 'checking' } })
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'checking' }, currentView: 'home' })
    },
  },
  {
    // 代码审查三轮第 13 项：原先按钮以 on:click={initializeApp} 接线，MouseEvent 被当作
    // installStatusKnown 的真值，跳过探测、installState 停在 status_error，数据随后加载成功时
    // 安装页一直留在屏幕上。现在按钮接 retryInstallStatus，事件对象不再流入。
    name: 'install page retry button: the click event is ignored, status is re-probed and installState reset',
    plan: { status: [{ error: new Error('boom') }, { value: installed }], refreshPublic: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'retry', impl.retryInstallStatus({ type: 'click' })); await flush()
    },
    check: ({ impl, world }) => {
      const probes = world.log.filter(e => e.call === 'status')
      expect(probes).toHaveLength(2)
      expect(probes[1].state).toMatchObject({ booting: true, installState: { type: 'checking' } })
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'checking' }, currentView: 'home' })
      expect(getInstallViewState(impl.read().installState)).toBeNull()
    },
  },
  {
    name: 'install page retry button while the status endpoint is still down: shows the fresh status error',
    plan: { status: [{ error: new Error('boom') }, { error: new Error('still down') }] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'retry', impl.retryInstallStatus({ type: 'click' })); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(2)
      expect(world.log.some(e => e.call === 'refreshPublicData')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'status_error', message: 'still down' } })
    },
  },

  // --- 竞态（与原实现一样不做过期防护）---
  {
    name: 'two overlapping boots resolving out of order: both complete, last writer wins',
    plan: {
      status: [{ defer: 's1' }, { defer: 's2' }],
      refreshPublic: [{}, {}],
    },
    drive: async (impl, w, s) => {
      const a = init(impl, s, 'a')
      const b = init(impl, s, 'b')
      await flush()
      await w.release('s2', { value: needsInstall })
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'pending' } })
      // 过期的第一个探测稍后返回「已安装」：原实现会照常继续启动并覆盖状态。
      await w.release('s1', { value: installed })
      await Promise.all([a, b])
    },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['b:ok', 'a:ok'])
      expect(world.log.filter(e => e.call === 'refreshPublicData')).toHaveLength(1)
      // installState 仍是第二个探测留下的 pending：Install 视图保持显示（原样保留）。
      expect(impl.read()).toMatchObject({ booting: false, installState: { type: 'pending' }, currentView: 'home' })
    },
  },
  {
    name: 'overlapping boots during data load: stale completion still applies its view',
    plan: {
      hint: true,
      publicMode: false,
      refreshPublic: [{ defer: 'p1' }, { defer: 'p2' }],
      ensure: [{}, {}],
    },
    drive: async (impl, w, s) => {
      const a = init(impl, s, 'a')
      await flush()
      const b = init(impl, s, 'b')
      await flush()
      await w.release('p2', { effect: (world) => { world.loggedIn = true } })
      await w.release('p1')
      await Promise.all([a, b])
    },
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['b:ok', 'a:ok'])
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home', loginModalOpen: false })
    },
  },
  {
    name: 'overlapping boots: the older one finishing first reveals the app while the newer is still loading',
    plan: { hint: true, refreshPublic: [{ defer: 'p1' }, { defer: 'p2' }] },
    drive: async (impl, w, s) => {
      const a = init(impl, s, 'a')
      await flush()
      const b = init(impl, s, 'b')
      await flush()
      await w.release('p1')
      // 原实现没有代次防护：较早的启动完成即揭开应用，哪怕较新的启动仍在加载。
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
      await w.release('p2')
      await Promise.all([a, b])
    },
    check: ({ settled }) => { expect(settled).toEqual(['a:ok', 'b:ok']) },
  },
  {
    name: 'a retry whose auth init fails does not reuse the previous boot\'s data error for the recheck',
    plan: {
      hint: true,
      initializeAuth: [{}, { error: new Error('auth down') }],
      refreshPublic: [publicFailure(serverError), {}],
      status: [{ value: installed }],
    },
    drive: async (impl, _w, s) => {
      await init(impl, s, 'first'); await flush()
      await init(impl, s, 'retry'); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(1)
      expect(impl.read()).toMatchObject({ booting: false, rootError: 'auth down', currentView: 'home' })
    },
  },
  {
    name: 'data error whose message was cleared meanwhile: no recheck (rootError gate)',
    plan: {
      hint: true,
      refreshPublic: [{ effect: (w) => { w.impl.onRootError('服务器错误', serverError); w.impl.clearRootError() } }],
    },
    drive: async (impl, _w, s) => { await init(impl, s); await flush() },
    check: ({ impl, world }) => {
      expect(world.log.some(e => e.call === 'status')).toBe(false)
      expect(impl.read()).toMatchObject({ booting: false, rootError: '', currentView: 'home' })
    },
  },
  {
    name: 'cancelling recovery resets a leftover install screen state even when no probe runs',
    plan: { status: [{ value: needsInstall }], refreshPublic: [{}] },
    drive: async (impl, w, s) => {
      await init(impl, s); await flush()
      w.storage?.set('cf-navs:installed', '1')
      w.pathname = '/'
      impl.enterRecover()
      impl.cancelRecover(); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.filter(e => e.call === 'status')).toHaveLength(1)
      expect(impl.read()).toMatchObject({ booting: false, recoverActive: false, installState: { type: 'checking' } })
    },
  },
  {
    name: 'local snapshot reveals home while the remote refresh is still in flight',
    plan: { hint: true, refreshPublic: [{ defer: 'p', effect: (w) => w.impl.onLocalSnapshotRestored() }] },
    drive: async (impl, w, s) => {
      const a = init(impl, s)
      await flush()
      impl.onLocalSnapshotRestored()
      expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' })
      await w.release('p')
      await a
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ booting: false, currentView: 'home' }) },
  },
  {
    name: 'local snapshot does not reveal on /admin or for a private site',
    plan: { hint: true, pathname: '/admin', refreshPublic: [{ defer: 'p' }], ensure: [{}] },
    drive: async (impl, w, s) => {
      const a = init(impl, s)
      await flush()
      impl.onLocalSnapshotRestored()
      expect(impl.read().booting).toBe(true)
      w.pathname = '/'
      w.publicMode = false
      impl.onLocalSnapshotRestored()
      expect(impl.read().booting).toBe(true)
      await w.release('p')
      await a
    },
  },
  {
    name: 'local snapshot after boot finished is a no-op',
    plan: { hint: true, publicMode: false, refreshPublic: [{}], ensure: [{}] },
    drive: async (impl, w, s) => {
      await init(impl, s); await flush()
      w.publicMode = true
      impl.onLocalSnapshotRestored()
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ currentView: 'login', loginModalOpen: true }) },
  },

  // --- 找回 ---
  {
    name: 'direct /recover: recover screen, no boot',
    plan: { pathname: '/recover' },
    drive: async (impl, _w, s) => { await boot(impl, s); await flush() },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['start:false', 'start:ok'])
      expect(world.log).toEqual([])
      expect(impl.read()).toMatchObject({ booting: false, recoverActive: true })
    },
  },
  {
    name: 'recovered: leaves recovery and enters the app with the new session',
    plan: { pathname: '/recover/x', refreshLoggedIn: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      await track(s, 'recovered', impl.recovered(session)); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'setSession')?.state.recoverActive).toBe(false)
      expect(world.pathname).toBe('/')
      expect(impl.read()).toMatchObject({ booting: false, recoverActive: false, currentView: 'home' })
    },
  },
  {
    name: 'recover → go install: re-probes from /install',
    plan: { pathname: '/recover', status: [{ value: needsInstall }] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      impl.goInstall(); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.log[0]).toMatchObject({ call: 'replacePath', args: ['/install'] })
      expect(impl.read()).toMatchObject({ booting: false, recoverActive: false, installState: { type: 'pending' } })
    },
  },
  {
    name: 'recover → cancel: back to / and boot',
    plan: { pathname: '/recover', hint: true, refreshPublic: [{}] },
    drive: async (impl, _w, s) => {
      await boot(impl, s); await flush()
      impl.cancelRecover(); await flush()
    },
    check: ({ impl, world }) => {
      expect(world.pathname).toBe('/')
      expect(impl.read()).toMatchObject({ booting: false, recoverActive: false, currentView: 'home' })
    },
  },
  {
    name: 'forgot password from a booted app enters recovery without touching boot state',
    plan: { hint: true, publicMode: false, refreshPublic: [{}], ensure: [{}] },
    drive: async (impl, _w, s) => {
      await init(impl, s); await flush()
      impl.enterRecover()
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ booting: false, recoverActive: true, currentView: 'login' }) },
  },
]

function runScenario(sc: Scenario, attach: (w: World) => Impl): Promise<Result> {
  const world = new World(sc.plan)
  const impl = attach(world)
  const settled: string[] = []
  return sc.drive(impl, world, settled).then(async () => {
    await flush()
    return { world, impl, settled }
  })
}

describe('app boot controller', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      const ours = await runScenario(sc, attachController)
      const legacy = await runScenario(sc, attachLegacy)

      expect(ours.world.log).toEqual(legacy.world.log)
      expect(ours.impl.read()).toEqual(legacy.impl.read())
      expect(ours.world.snapshot()).toEqual(legacy.world.snapshot())
      expect(ours.settled).toEqual(legacy.settled)
      expect(ours.world.gates.size).toBe(0)
      sc.check?.(ours)
    })
  }

  it('publishes a fresh snapshot on every change and keeps installState identity otherwise', async () => {
    const world = new World({ status: [{ value: needsInstall }] })
    const states: Array<ReturnType<Impl['read']>> = []
    attachController(world)
    const boot = createAppBootController({
      ...minimalDeps(world),
      onChange: (s) => states.push({ ...s, rootError: '', currentView: 'home', loginModalOpen: false }),
    })
    expect(boot.getState()).toEqual({ booting: true, installState: { type: 'checking' }, recoverActive: false })
    await boot.initializeApp()
    // booting=true（initializeApp 开头）→ checking → pending → booting=false
    expect(states.map(s => [s.booting, s.installState.type])).toEqual([
      [true, 'checking'], [true, 'checking'], [true, 'pending'], [false, 'pending'],
    ])
    expect(states[1].installState).not.toBe(states[0].installState)
    expect(states[3].installState).toBe(states[2].installState)
  })

  it('records a data error without publishing', () => {
    const world = new World({})
    let calls = 0
    const boot = createAppBootController({ ...minimalDeps(world), onChange: () => { calls += 1 } })
    boot.recordDataError(serverError)
    expect(calls).toBe(0)
  })
})

describe('browser install hint storage', () => {
  it('returns null without window', () => {
    expect(getBrowserInstallHintStorage()).toBeNull()
  })

  it('returns localStorage, or null when access throws', () => {
    const g = globalThis as { window?: unknown }
    const storage = {} as Storage
    try {
      g.window = { localStorage: storage }
      expect(getBrowserInstallHintStorage()).toBe(storage)
      g.window = Object.defineProperty({}, 'localStorage', { get() { throw new Error('denied') } })
      expect(getBrowserInstallHintStorage()).toBeNull()
    } finally {
      delete g.window
    }
  })
})

function minimalDeps(w: World): AppBootDeps {
  return {
    onChange: () => {},
    installApi: w.installApi,
    getInstallHintStorage: () => w.storageApi(),
    getPathname: () => w.pathname,
    replacePath: (p) => w.replacePath(p),
    clearCachedAdminData: async () => {},
    clearCachedPublicData: async () => {},
    setSession: (s) => w.setSession(s),
    initializeAuth: async () => {},
    resetAdminData: () => {},
    isLoggedIn: () => w.loggedIn,
    refreshLoggedInData: async () => {},
    refreshPublicData: async () => {},
    getPublicMode: () => w.publicMode,
    isAdminPath: () => false,
    ensureLazyComponent: async () => {},
    getRootError: () => '',
    setRootError: () => {},
    setLoginModalOpen: () => {},
    setCurrentView: () => {},
  }
}

// ---------------------------------------------------------------------------
// legacy：逐字复刻拆分前 App.svelte（HEAD 04a2204）的启动 / 安装 / 找回代码。
// 仅做机械替换：App 作用域变量 → `app.xxx`，模块级依赖 → 世界替身
// （api.install → w.installApi、window.location.pathname → w.pathname、authStore / adminStore /
// configStore / lazyComponents / 缓存清理 → 同名替身），控制流与语句顺序不变。
// ---------------------------------------------------------------------------

function attachLegacy(w: World): Impl {
  const app = {
    booting: true,
    installState: { type: 'checking' } as InstallScreenState,
    recoverActive: false,
    rootError: '',
    lastDataError: null as unknown,
    currentView: 'home' as AppView,
    loginModalOpen: false,
  }
  const api = { install: w.installApi }
  const window = w.pathname === null ? undefined : { location: { get pathname() { return w.pathname! } } }
  const replaceBrowserPath = (p: string) => w.replacePath(p)
  const authStore = {
    setSession: (s: LoginResp | null) => w.setSession(s),
    initialize: () => w.run('initializeAuth', 'initializeAuth', []).then(() => undefined),
  }
  const adminStore = { reset: () => w.record('resetAdminData') }
  const clearCachedAdminData = async () => { w.record('clearCachedAdminData') }
  const clearCachedPublicData = async () => { w.record('clearCachedPublicData') }
  const isLoggedIn = () => w.loggedIn
  const refreshLoggedInData = () => w.run('refreshLoggedIn', 'refreshLoggedInData', [])
  const refreshPublicData = (...args: [boolean?]) => w.run('refreshPublic', 'refreshPublicData', args)
  const getPublicMode = () => w.publicMode
  const lazyComponents = { ensure: (name: string) => w.run('ensure', 'ensure', [name]) }
  function isAdminPath(): boolean {
    if (typeof window === 'undefined') return false
    return window.location.pathname === '/admin' || window.location.pathname === '/admin/'
  }

  function getInstallHintStorage() {
    return w.storageApi()
  }

  function rememberInstalled(installed: boolean): void {
    setInstalledHint(getInstallHintStorage(), installed)
  }

  async function enterInstalledApp(session: LoginResp | null): Promise<void> {
    await Promise.all([clearCachedAdminData(), clearCachedPublicData()])
    rememberInstalled(true)
    authStore.setSession(session)
    replaceBrowserPath('/')
    app.installState = { type: 'checking' }
    await initializeApp(true)
  }

  async function checkInstallStatus(forceProbe = false): Promise<boolean> {
    const installedHint = hasInstalledHint(getInstallHintStorage())
    const pathname = typeof window === 'undefined' ? '/' : window.location.pathname

    if (!shouldProbeInstallStatus({ installedHint, pathname, forceProbe })) {
      return true
    }

    app.installState = { type: 'checking' }

    try {
      const status = await api.install.status()
      if (status.state !== 'installed') {
        if (canUseInstalledFallback(status, installedHint)) {
          if (typeof window !== 'undefined' && isInstallPath(window.location.pathname)) {
            replaceBrowserPath('/')
          }
          return true
        }

        rememberInstalled(false)
        replaceBrowserPath('/install')
        app.installState = toInstallScreenState(status)
        app.booting = false
        return false
      }

      rememberInstalled(true)
      if (typeof window !== 'undefined' && isInstallPath(window.location.pathname)) {
        replaceBrowserPath('/')
      }
      return true
    } catch (error) {
      if (installedHint) {
        if (typeof window !== 'undefined' && isInstallPath(window.location.pathname)) {
          replaceBrowserPath('/')
        }
        return true
      }

      app.installState = { type: 'status_error', message: normalizeInstallError(error) }
      app.booting = false
      return false
    }
  }

  async function recheckInstallAfterDataError(error: unknown): Promise<boolean> {
    if (!shouldRecheckInstallAfterDataError(error)) return false
    return !await checkInstallStatus(true)
  }

  async function handleInstall(value: { setupToken: string; username: string; password: string }): Promise<void> {
    if (app.installState.type !== 'pending' || app.installState.status.state !== 'needs_install') return

    const pendingStatus = app.installState.status
    app.installState = { type: 'installing', status: pendingStatus }

    try {
      const session = await api.install.install(
        { username: value.username, password: value.password },
        value.setupToken,
      )
      await enterInstalledApp(session)
    } catch (error) {
      if (await installationCommittedAfterFailure(api.install.status)) {
        await enterInstalledApp(null)
        return
      }

      app.installState = {
        type: 'pending',
        status: pendingStatus,
        error: normalizeInstallError(error),
      }
    }
  }

  // 原签名为 `installStatusKnown = false`；按钮 on:click 会把事件对象传进来，这里同样接受任意值。
  async function initializeApp(installStatusKnown: unknown = false): Promise<void> {
    app.booting = true
    app.rootError = ''
    app.lastDataError = null

    if (!installStatusKnown && !await checkInstallStatus()) {
      return
    }

    try {
      await authStore.initialize()
    } catch (error) {
      app.rootError = getErrorMessage(error)
    }

    adminStore.reset()
    if (isLoggedIn()) {
      try {
        await refreshLoggedInData()
      } catch (error) {
        if (isUnauthorizedError(error)) {
          authStore.setSession(null)
          adminStore.reset()
          await clearCachedAdminData()
        } else {
          if (await recheckInstallAfterDataError(error)) return
          app.rootError = getErrorMessage(error)
        }

        await refreshPublicData()
      }
    } else {
      await refreshPublicData(true)
      if (app.rootError && await recheckInstallAfterDataError(app.lastDataError)) return
    }

    const homeGate = createHomeGateState({
      publicMode: getPublicMode(),
      authenticated: isLoggedIn(),
    })
    if (homeGate.loginModalOpen) {
      await lazyComponents.ensure('LoginModal')
    }
    app.loginModalOpen = homeGate.loginModalOpen
    if (isAdminPath() && isLoggedIn()) {
      await lazyComponents.ensure('Admin')
      app.currentView = 'admin'
      app.loginModalOpen = false
    } else {
      app.currentView = homeGate.view
    }
    app.booting = false
  }

  function revealHomeFromCurrentData(): void {
    const homeGate = createHomeGateState({
      publicMode: getPublicMode(),
      authenticated: isLoggedIn(),
    })
    if (!shouldRevealHomeFromLocalSnapshot({
      booting: app.booting,
      adminPath: isAdminPath(),
      homeView: homeGate.view,
    })) return

    app.loginModalOpen = false
    app.currentView = 'home'
    app.booting = false
  }

  async function handleRecovered(session: LoginResp): Promise<void> {
    app.recoverActive = false
    await enterInstalledApp(session)
  }
  function handleGoInstall(): void {
    replaceBrowserPath('/install')
    app.recoverActive = false
    app.installState = { type: 'checking' }
    void initializeApp()
  }
  function handleRecoverCancel(): void {
    replaceBrowserPath('/')
    app.recoverActive = false
    app.installState = { type: 'checking' }
    void initializeApp()
  }

  const impl: Impl = {
    // onMount 中的对应片段；返回值表示是否继续（原先继续时才安装焦点刷新）。
    start() {
      if (typeof window !== 'undefined' && isRecoverPath(window.location.pathname)) {
        app.recoverActive = true
        app.booting = false
        return false
      }
      void initializeApp()
      return true
    },
    initializeApp,
    // 第 13 项修复后的接线（原为 on:click={initializeApp}，事件对象会流入 installStatusKnown）。
    retryInstallStatus: () => initializeApp(),
    install: handleInstall,
    recovered: handleRecovered,
    goInstall: handleGoInstall,
    cancelRecover: handleRecoverCancel,
    // handleForgotPassword 中属于启动状态的那一行。
    enterRecover() {
      app.recoverActive = true
    },
    // configureDataService 的回调。
    onRootError(message, error) {
      app.rootError = message
      app.lastDataError = error
    },
    onLocalSnapshotRestored() {
      revealHomeFromCurrentData()
    },
    clearRootError() {
      app.rootError = ''
    },
    read: () => ({
      booting: app.booting,
      installState: app.installState,
      recoverActive: app.recoverActive,
      rootError: app.rootError,
      currentView: app.currentView,
      loginModalOpen: app.loginModalOpen,
    }),
  }
  w.impl = impl
  return impl
}
