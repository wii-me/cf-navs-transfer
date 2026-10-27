import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminData, BatchDeleteCategoriesResp, Category, CategoryUpsertReq } from '../../shared/types'
import { getErrorMessage } from '../../src/lib/api'
import { toCategoryForm, toCategoryPayload } from '../../src/lib/adminFormAdapters'
import type { CategoryFormValue } from '../../src/lib/adminTypes'
import { runAdminMutation } from '../../src/lib/appAdminMutation'
import {
  createCategoryController,
  type CategoryControllerDeps,
  type CategoryEditorState,
} from '../../src/lib/appCategoryController'
import {
  createBatchDeleteConfirmation,
  createDeleteCategoryConfirmation,
  type ConfirmDialogInput,
} from '../../src/lib/appConfirmDialog'
import { createEditIntentCounter } from '../../src/lib/appEditIntent'
import { createCategoryDraft } from '../../src/lib/appModalState'
import type { AppView } from '../../src/lib/appNavigation'
import { createOptimisticSortState, runOptimisticSort } from '../../src/lib/appSortQueue'
import { toastStore } from '../../src/lib/toast'
import { flush, track, UseCaseWorld, type Plan } from '../helpers/useCaseWorld'

// 代码审查三轮第 14 项：App.svelte 拆分第 7a 步（分类用例）。
// 每个用例在同一份脚本下分别驱动新控制器与逐字复刻的原 App 实现（见文件末尾 legacy），
// 断言两者的依赖调用序列（含每次调用时的完整状态快照）、最终状态与 promise 结果完全一致，
// 再对控制器的结果做语义断言。toast 与 console.warn 也作为依赖调用记入日志。

// ---------------------------------------------------------------------------
// 测试世界
// ---------------------------------------------------------------------------

interface Snap extends CategoryEditorState {
  editIntent: number
  rootError: string
  currentView: AppView
  homeFocusCategoryId: number | null
}

interface Impl {
  openCreate(parentId?: string | number | null, override?: boolean): Promise<void>
  openCreateRoot(): Promise<void>
  openEdit(category: { id: string | number }): Promise<void>
  close(): Promise<void>
  submit(form: CategoryFormValue): Promise<void>
  remove(category: { id: string | number; title: string }): Promise<void>
  batchRemove(ids: number[]): Promise<void>
  sort(parentId: number | null, ids: Array<string | number>): Promise<void>
  /** 登出 / 改密中的 resetCategoryState()。 */
  reset(): void
  /** 书签侧推进共享计数（handleOpenCreateBookmark / handleEditBookmark / resetBookmarkState）。 */
  bumpIntent(): void
  read(): Snap
}

interface Ctx {
  loggedIn: boolean
  adminData: Pick<AdminData, 'categories' | 'bookmarks'>
}

const cat = (id: number, parentId: number | null = null, title = `C${id}`) =>
  ({ id, parent_id: parentId, title, icon: null, is_private: 0, sort: id, created_at: 0 }) as Category
const bm = (id: number, categoryId: number) => ({ id, category_id: categoryId }) as unknown as AdminData['bookmarks'][number]

const baseAdminData = (): Ctx['adminData'] => ({
  categories: [cat(1), cat(2, 1), cat(3, 1), cat(4)],
  bookmarks: [bm(10, 1), bm(11, 1), bm(12, 2), bm(13, 4)],
})

class World extends UseCaseWorld {
  ctx: Ctx
  impl!: Impl
  constructor(plan: Plan, ctx: Partial<Ctx> = {}) {
    super(plan, {
      ensureLoggedInDataLoaded: true,
      confirm: true,
      readAdminDataForEdit: { ...baseAdminData(), settings: null },
      'api.create': cat(50, null, 'New'),
      'api.update': cat(1, null, 'Edited'),
      'api.batchDelete': { deleted: 2, deleted_bookmarks: 1 },
    })
    this.ctx = { loggedIn: true, adminData: baseAdminData(), ...ctx }
    this.snapshot = () => ({ ...this.impl.read(), loggedIn: this.ctx.loggedIn })
  }
}

let activeWorld: World | null = null

beforeEach(() => {
  vi.spyOn(toastStore, 'addToast').mockImplementation((message, type) => {
    activeWorld?.record('toast', message, type)
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

// 两个实现共用的依赖替身（对应 App 里的模块函数与回调）。
function doubles(w: World) {
  return {
    isLoggedIn: () => {
      w.record('isLoggedIn')
      return w.ctx.loggedIn
    },
    openLogin: () => w.call<void>('openLogin'),
    ensureLoggedInDataLoaded: () => w.call<boolean>('ensureLoggedInDataLoaded'),
    ensureLazyComponent: (name: string) => w.call('ensure', name),
    readAdminDataForEdit: () => w.call<AdminData | null>('readAdminDataForEdit'),
    requestConfirmation: (input: ConfirmDialogInput) => w.call<boolean>('confirm', input),
    api: {
      categories: {
        create: (payload: CategoryUpsertReq) => w.call<Category>('api.create', payload),
        update: (id: number, payload: CategoryUpsertReq) => w.call<Category>('api.update', id, payload),
        remove: (id: number) => w.call('api.remove', id),
        batchDelete: (ids: number[]) => w.call<BatchDeleteCategoriesResp>('api.batchDelete', ids),
        sort: (parentId: number | null, ids: number[]) => w.call('api.sort', parentId, ids),
      },
    },
    applyLocalCategoryUpsert: (category: Category) => w.call<void>('applyLocalUpsert', category),
    applyLocalCategoryDelete: (id: number) => w.call<void>('applyLocalDelete', id),
    applyLocalCategorySort: (parentId: number | null, ids: number[], refreshMissing?: boolean) =>
      w.call<void>('applyLocalSort', parentId, ids, refreshMissing),
    persistCurrentAdminData: (...args: unknown[]) => w.call<void>('persist', ...args),
    refreshAdminDataAfterMutation: () => w.call<void>('refreshAfterMutation'),
    // 差分对照里与 legacy 的「写后刷新」是同一步；走哪条路径由下方 post-write refresh 用例单独钉住。
    confirmAdminDataAfterLocalMutation: () => w.call<void>('refreshAfterMutation'),
    refreshLoggedInData: (force?: boolean) => w.call<void>('refreshLoggedIn', force),
    tick: () => w.call<void>('tick'),
  }
}

// ---------------------------------------------------------------------------
// 新控制器接到世界上（接线方式与 App.svelte 相同）
// ---------------------------------------------------------------------------

function attachController(w: World): Impl {
  const d = doubles(w)
  const editIntent = createEditIntentCounter()
  let rootError = ''
  let currentView: AppView = 'home'
  let homeFocusCategoryId: number | null = null
  let published: CategoryEditorState | null = null
  const deps: CategoryControllerDeps = {
    ...d,
    onChange: (next) => { published = next },
    editIntent,
    getAdminData: () => w.ctx.adminData,
    setRootError: (message) => { rootError = message },
    setCurrentView: (view) => { currentView = view },
    setHomeFocusCategoryId: (id) => { homeFocusCategoryId = id },
  }
  const controller = createCategoryController(deps)
  // 与 App 一样：初值取自构造后的 getState()，之后只经 onChange 更新。
  published = controller.getState()
  const impl: Impl = {
    openCreate: (...args) => controller.openCreate(...args),
    openCreateRoot: () => controller.openCreateRoot(),
    openEdit: (c) => controller.openEdit(c),
    close: () => controller.close(),
    submit: (f) => controller.submit(f),
    remove: (c) => controller.remove(c),
    batchRemove: (ids) => controller.batchRemove(ids),
    sort: (p, ids) => controller.sort(p, ids),
    reset: () => controller.reset(),
    bumpIntent: () => { editIntent.next() },
    // App 只通过 onChange 拿到状态：读最近一次推送（尚未推送时为初始状态），并核对与 getState 一致
    // （漏推送会让二者不一致）。
    read: () => {
      const state = published!
      expect(state).toEqual(controller.getState())
      return { ...state, editIntent: editIntent.current(), rootError, currentView, homeFocusCategoryId }
    },
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

const form = (patch: Partial<CategoryFormValue> = {}): CategoryFormValue => ({ parent_id: null, title: ' New ', icon: '', ...patch })
const calls = (w: World) => w.log.map(e => e.call)
const boom = new Error('boom')

const scenarios: Scenario[] = [
  // --- 新建 ---
  {
    name: 'open create while logged out: opens login and leaves the form closed',
    ctx: { loggedIn: false },
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate()),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(['isLoggedIn', 'openLogin'])
      expect(impl.read()).toMatchObject({ modalOpen: false, editIntent: 1 })
    },
  },
  {
    name: 'open create when logged-in data cannot be loaded: stays closed',
    plan: { ensureLoggedInDataLoaded: [{ value: false }] },
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate(3)),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(['isLoggedIn', 'ensureLoggedInDataLoaded'])
      expect(impl.read()).toMatchObject({ modalOpen: false, editIntent: 1 })
    },
  },
  {
    name: 'open create from admin (no parent): loads Admin and switches to the admin view',
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate()),
    check: ({ impl, world }) => {
      expect(world.log.at(-1)).toMatchObject({ call: 'ensure', args: ['Admin'] })
      expect(impl.read()).toMatchObject({
        modalOpen: true, modalMode: 'create', active: createCategoryDraft(null), createReturnToHome: false, currentView: 'admin',
      })
    },
  },
  {
    name: 'open create with a parent (from home): loads the modal and stays on home',
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate(3)),
    check: ({ impl, world }) => {
      expect(world.log.at(-1)).toMatchObject({ call: 'ensure', args: ['CategoryEditModal'] })
      expect(impl.read()).toMatchObject({ modalOpen: true, active: { parent_id: 3 }, createReturnToHome: true, currentView: 'home' })
    },
  },
  {
    name: 'open create with a parent but override=false: behaves like admin',
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate('3', false)),
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ active: { parent_id: '3' }, createReturnToHome: false, currentView: 'admin' })
    },
  },
  {
    name: 'open create root from home: parent null but returns home',
    drive: (impl, _w, s) => track(s, 'open', impl.openCreateRoot()),
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ modalOpen: true, active: { parent_id: null }, createReturnToHome: true, currentView: 'home' })
    },
  },
  {
    name: 'open create clears a previous category error',
    plan: { 'api.remove': [{ error: boom }] },
    drive: async (impl, _w, s) => {
      await track(s, 'del', impl.remove({ id: 4, title: 'C4' }))
      expect(impl.read().error).toBe('boom')
      await track(s, 'open', impl.openCreate())
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ error: '', modalOpen: true }) },
  },
  {
    name: 'open create when the chunk fails to load: rejects and leaves state untouched',
    plan: { ensure: [{ error: new Error('chunk') }] },
    drive: (impl, _w, s) => track(s, 'open', impl.openCreate(1)),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['open:err:chunk'])
      expect(impl.read()).toMatchObject({ modalOpen: false, createReturnToHome: false })
    },
  },

  // --- 编辑 ---
  {
    name: 'edit: reads raw admin data and opens the form in edit mode',
    drive: (impl, _w, s) => track(s, 'edit', impl.openEdit({ id: '2' })),
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ modalOpen: true, modalMode: 'edit', active: toCategoryForm(cat(2, 1)), editIntent: 1 })
    },
  },
  {
    name: 'edit when no raw data is available: does nothing',
    plan: { readAdminDataForEdit: [{ value: null }] },
    drive: (impl, _w, s) => track(s, 'edit', impl.openEdit({ id: 2 })),
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ modalOpen: false, rootError: '' }) },
  },
  {
    name: 'edit a category that no longer exists: root error',
    drive: (impl, _w, s) => track(s, 'edit', impl.openEdit({ id: 99 })),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['edit:ok'])
      expect(impl.read()).toMatchObject({ modalOpen: false, rootError: '无法读取分类的原始编辑数据：分类已不存在，请刷新后重试。' })
    },
  },
  {
    name: 'edit when reading raw data fails: root error with the message',
    plan: { readAdminDataForEdit: [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'edit', impl.openEdit({ id: 2 })),
    check: ({ impl }) => { expect(impl.read().rootError).toBe('无法读取分类的原始编辑数据：boom') },
  },
  {
    name: 'edit superseded by a bookmark action on the shared counter: result dropped',
    plan: { readAdminDataForEdit: [{ defer: 'r' }] },
    drive: async (impl, w, s) => {
      const p = track(s, 'edit', impl.openEdit({ id: 2 }))
      await flush()
      impl.bumpIntent()
      await w.release('r', { value: { ...baseAdminData(), settings: null } })
      await p
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ modalOpen: false, editIntent: 2 }) },
  },
  {
    name: 'edit superseded and then failing: no root error',
    plan: { readAdminDataForEdit: [{ defer: 'r' }] },
    drive: async (impl, w, s) => {
      const p = track(s, 'edit', impl.openEdit({ id: 2 }))
      await flush()
      impl.reset()
      await w.release('r', { error: boom })
      await p
    },
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ modalOpen: false, rootError: '', editIntent: 2 }) },
  },
  {
    name: 'two overlapping edits: only the latest opens',
    plan: { readAdminDataForEdit: [{ defer: 'a' }, { defer: 'b' }] },
    drive: async (impl, w, s) => {
      const a = track(s, 'a', impl.openEdit({ id: 1 }))
      const b = track(s, 'b', impl.openEdit({ id: 4 }))
      await flush()
      await w.release('b', { value: { ...baseAdminData(), settings: null } })
      await w.release('a', { value: { ...baseAdminData(), settings: null } })
      await Promise.all([a, b])
    },
    check: ({ impl }) => { expect(impl.read().active).toEqual(toCategoryForm(cat(4))) },
  },
  {
    name: 'close resets the form and bumps the shared counter',
    drive: async (impl, _w, s) => {
      await track(s, 'edit', impl.openEdit({ id: 2 }))
      await track(s, 'close', impl.close())
    },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ modalOpen: false, modalMode: 'create', active: null, error: '', saving: false, createReturnToHome: false, editIntent: 2 })
    },
  },

  // --- 提交 ---
  {
    name: 'submit create from admin: saves, resets, applies locally, refreshes, toasts 已创建',
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openCreate())
      await track(s, 'submit', impl.submit(form()))
    },
    check: ({ impl, world }) => {
      const apiCall = world.log.find(e => e.call === 'api.create')!
      expect(apiCall.args).toEqual([toCategoryPayload(form())])
      expect(apiCall.state).toMatchObject({ saving: true, error: '', modalOpen: true })
      expect(calls(world).slice(-4)).toEqual(['api.create', 'applyLocalUpsert', 'refreshAfterMutation', 'toast'])
      expect(world.log.find(e => e.call === 'applyLocalUpsert')!.state).toMatchObject({ modalOpen: false, saving: false })
      expect(world.log.at(-1)!.args).toEqual(['分类「New」已创建', 'success'])
      expect(impl.read()).toMatchObject({ modalOpen: false, saving: false, currentView: 'admin', homeFocusCategoryId: null })
    },
  },
  {
    name: 'submit edit: update API and 已更新 toast (intent from the form, not the reset mode)',
    drive: async (impl, _w, s) => {
      await track(s, 'edit', impl.openEdit({ id: 1 }))
      await track(s, 'submit', impl.submit(form({ id: 1, title: 'Edited' })))
    },
    check: ({ world }) => {
      expect(world.log.find(e => e.call === 'api.update')!.args[0]).toBe(1)
      expect(world.log.at(-1)!.args).toEqual(['分类「Edited」已更新', 'success'])
    },
  },
  {
    name: 'submit create from home: returns home and focuses the new category across two ticks',
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openCreate(1))
      await track(s, 'submit', impl.submit(form({ parent_id: 1 })))
    },
    check: ({ impl, world }) => {
      const ticks = world.log.filter(e => e.call === 'tick')
      expect(ticks).toHaveLength(2)
      expect(ticks[0].state).toMatchObject({ currentView: 'home', homeFocusCategoryId: null })
      expect(ticks[1].state).toMatchObject({ homeFocusCategoryId: 50 })
      expect(calls(world).at(-1)).toBe('toast')
      expect(impl.read()).toMatchObject({ currentView: 'home', homeFocusCategoryId: 50, createReturnToHome: false })
    },
  },
  {
    name: 'submit failure: keeps the form open with the error and clears saving',
    plan: { 'api.create': [{ error: boom }] },
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openCreate())
      await track(s, 'submit', impl.submit(form()))
    },
    check: ({ impl, world, settled }) => {
      expect(settled).toEqual(['open:ok', 'submit:ok'])
      expect(calls(world)).not.toContain('toast')
      expect(impl.read()).toMatchObject({ modalOpen: true, error: 'boom', saving: false })
    },
  },
  {
    name: 'submit where the local apply fails after the reset: error lands on the closed form',
    plan: { applyLocalUpsert: [{ error: new Error('idb') }] },
    drive: async (impl, _w, s) => {
      await track(s, 'open', impl.openCreate(1))
      await track(s, 'submit', impl.submit(form()))
    },
    check: ({ impl, world }) => {
      expect(calls(world)).not.toContain('refreshAfterMutation')
      expect(impl.read()).toMatchObject({ modalOpen: false, error: 'idb', saving: false, currentView: 'home' })
    },
  },
  {
    name: 'submit with a malformed form: payload error goes to the form error',
    drive: async (impl, _w, s) => {
      await track(s, 'submit', impl.submit({ parent_id: null, title: 'x' } as unknown as CategoryFormValue))
    },
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual([])
      expect(impl.read().error).not.toBe('')
      expect(impl.read().saving).toBe(false)
    },
  },
  {
    name: 'reset while a submit is in flight: completion still clears saving and toasts',
    plan: { 'api.create': [{ defer: 'c' }] },
    drive: async (impl, w, s) => {
      await track(s, 'open', impl.openCreate(1))
      const p = track(s, 'submit', impl.submit(form()))
      await flush()
      impl.reset()
      await w.release('c', { value: cat(51) })
      await p
    },
    check: ({ impl, world }) => {
      // returnToHome 是提交开始时读的：reset 后仍回到首页并聚焦。
      expect(impl.read()).toMatchObject({ saving: false, homeFocusCategoryId: 51, editIntent: 3 })
      expect(calls(world).at(-1)).toBe('toast')
    },
  },

  // --- 删除 ---
  {
    name: 'delete cancelled: no API call, no state change',
    plan: { confirm: [{ value: false }] },
    drive: (impl, _w, s) => track(s, 'del', impl.remove({ id: '1', title: 'C1' })),
    check: ({ impl, world }) => {
      expect(world.log.map(e => e.call)).toEqual(['confirm'])
      expect(world.log[0].args).toEqual([createDeleteCategoryConfirmation('C1', 2, 2)])
      expect(impl.read()).toMatchObject({ deletingId: null })
    },
  },
  {
    name: 'delete confirmed: deletingId during the call, local delete, refresh, toast',
    drive: (impl, _w, s) => track(s, 'del', impl.remove({ id: 1, title: 'C1' })),
    check: ({ impl, world }) => {
      expect(world.log.find(e => e.call === 'api.remove')!.state).toMatchObject({ deletingId: 1, error: '' })
      expect(calls(world)).toEqual(['confirm', 'api.remove', 'applyLocalDelete', 'refreshAfterMutation', 'toast'])
      expect(world.log.at(-1)!.args).toEqual(['分类「C1」已删除', 'success'])
      expect(impl.read().deletingId).toBeNull()
    },
  },
  {
    name: 'delete counts come from the admin data at call time',
    ctx: { adminData: { categories: [cat(7), cat(8, 7)], bookmarks: [bm(1, 7), bm(2, 7), bm(3, 7)] } },
    drive: (impl, _w, s) => track(s, 'del', impl.remove({ id: 7, title: 'C7' })),
    check: ({ world }) => { expect(world.log[0].args).toEqual([createDeleteCategoryConfirmation('C7', 3, 1)]) },
  },
  {
    name: 'delete failure: category error, deletingId cleared',
    plan: { 'api.remove': [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'del', impl.remove({ id: 1, title: 'C1' })),
    check: ({ impl }) => { expect(impl.read()).toMatchObject({ error: 'boom', deletingId: null }) },
  },

  // --- 批量删除 ---
  {
    name: 'batch delete with no ids: nothing',
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([])),
    check: ({ world }) => { expect(world.log).toEqual([]) },
  },
  {
    name: 'batch delete cancelled',
    plan: { confirm: [{ value: false }] },
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([1, 4])),
    check: ({ world }) => {
      expect(calls(world)).toEqual(['confirm'])
      expect(world.log[0].args).toEqual([createBatchDeleteConfirmation('category', 2, 3, 2)])
    },
  },
  {
    name: 'batch delete success refreshes and toasts the counts',
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([1, 4])),
    check: ({ world }) => {
      expect(calls(world)).toEqual(['confirm', 'api.batchDelete', 'refreshAfterMutation', 'toast'])
      expect(world.log.at(-1)!.args).toEqual(['已删除 2 个分类及 1 个书签', 'success'])
    },
  },
  {
    name: 'batch delete that removed nothing: no refresh',
    plan: { 'api.batchDelete': [{ value: { deleted: 0, deleted_bookmarks: 0 } }] },
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([99])),
    check: ({ world }) => { expect(calls(world)).toEqual(['confirm', 'api.batchDelete', 'toast']) },
  },
  {
    name: 'batch delete that removed only bookmarks still refreshes',
    plan: { 'api.batchDelete': [{ value: { deleted: 0, deleted_bookmarks: 3 } }] },
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([1])),
    check: ({ world }) => { expect(calls(world)).toContain('refreshAfterMutation') },
  },
  {
    name: 'batch delete failure: category error',
    plan: { 'api.batchDelete': [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'batch', impl.batchRemove([1])),
    check: ({ impl, settled }) => {
      expect(settled).toEqual(['batch:ok'])
      expect(impl.read().error).toBe('boom')
    },
  },

  // --- 排序 ---
  {
    name: 'sort success: optimistic local sort, save, persist, refresh',
    plan: { 'api.remove': [{ error: boom }] },
    drive: async (impl, _w, s) => {
      await track(s, 'del', impl.remove({ id: 4, title: 'C4' }))
      await track(s, 'sort', impl.sort(1, ['3', 2]))
    },
    check: ({ impl, world }) => {
      const sortCalls = world.log.slice(world.log.findIndex(e => e.call === 'applyLocalSort'))
      expect(sortCalls.map(e => e.call)).toEqual(['applyLocalSort', 'api.sort', 'persist', 'refreshAfterMutation'])
      expect(sortCalls[0]).toMatchObject({ args: [1, [3, 2], false], state: { error: '' } })
      expect(sortCalls[1].args).toEqual([1, [3, 2]])
      expect(sortCalls[2].args).toEqual([])
      expect(impl.read().error).toBe('')
    },
  },
  {
    name: 'sort failure: error and restore from the server',
    plan: { 'api.sort': [{ error: boom }] },
    drive: (impl, _w, s) => track(s, 'sort', impl.sort(null, [4, 1])),
    check: ({ impl, world }) => {
      expect(calls(world)).toEqual(['applyLocalSort', 'api.sort', 'refreshLoggedIn'])
      expect(world.log.at(-1)).toMatchObject({ args: [true], state: { error: 'boom' } })
      expect(impl.read().error).toBe('boom')
    },
  },
  {
    name: 'sort failure whose restore also fails: warns, keeps the save error',
    plan: { 'api.sort': [{ error: boom }], refreshLoggedIn: [{ error: new Error('restore') }] },
    drive: (impl, _w, s) => track(s, 'sort', impl.sort(null, [4, 1])),
    check: ({ impl, world }) => {
      expect(calls(world).at(-1)).toBe('warn')
      expect(impl.read().error).toBe('boom')
    },
  },
  {
    name: 'overlapping sorts: saves are queued and only the latest persists',
    plan: { 'api.sort': [{ defer: 's1' }, {}] },
    drive: async (impl, w, s) => {
      const a = track(s, 'a', impl.sort(null, [1, 4]))
      await flush()
      const b = track(s, 'b', impl.sort(null, [4, 1]))
      await flush()
      await w.release('s1')
      await Promise.all([a, b])
    },
    check: ({ world, settled }) => {
      expect(calls(world)).toEqual(['applyLocalSort', 'api.sort', 'applyLocalSort', 'api.sort', 'persist', 'refreshAfterMutation'])
      expect(settled).toEqual(['a:ok', 'b:ok'])
    },
  },
  {
    name: 'overlapping sorts where the first save fails: only the latest reports',
    plan: { 'api.sort': [{ defer: 's1' }, { error: new Error('second') }] },
    drive: async (impl, w, s) => {
      const a = track(s, 'a', impl.sort(null, [1, 4]))
      await flush()
      const b = track(s, 'b', impl.sort(null, [4, 1]))
      await flush()
      await w.release('s1', { error: new Error('first') })
      await Promise.all([a, b])
    },
    check: ({ impl, world }) => {
      expect(calls(world).filter(c => c === 'refreshLoggedIn')).toHaveLength(1)
      expect(impl.read().error).toBe('second')
    },
  },

  // --- 重置（登出 / 改密）---
  {
    name: 'reset from an open edit form clears everything',
    drive: async (impl, _w, s) => {
      await track(s, 'edit', impl.openEdit({ id: 2 }))
      impl.reset()
    },
    check: ({ impl }) => {
      expect(impl.read()).toMatchObject({ modalOpen: false, modalMode: 'create', active: null, editIntent: 2 })
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

describe('app category controller', () => {
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

  it('publishes a snapshot after every change and keeps the active form identity otherwise', async () => {
    const world = new World({})
    activeWorld = world
    attachController(world)
    const states: CategoryEditorState[] = []
    const controller = createCategoryController({
      ...doubles(world),
      onChange: (s) => states.push(s),
      editIntent: createEditIntentCounter(),
      getAdminData: () => world.ctx.adminData,
      setRootError: () => {},
      setCurrentView: () => {},
      setHomeFocusCategoryId: () => {},
    })
    expect(controller.getState()).toEqual({
      modalOpen: false, modalMode: 'create', active: null, saving: false, deletingId: null, error: '', createReturnToHome: false,
    })
    await controller.openEdit({ id: 2 })
    await controller.submit(form({ id: 2 }))
    // 打开 → saving=true → reset（同时清 saving）→ onSettled 再推送一次
    expect(states.map(s => [s.modalOpen, s.saving])).toEqual([[true, false], [true, true], [false, false], [false, false]])
    expect(states[1].active).toBe(states[0].active)
    expect(states[0]).not.toBe(states[1])
  })

  it('shares the injected edit intent counter with other controllers', async () => {
    const world = new World({ readAdminDataForEdit: [{ defer: 'r' }] })
    activeWorld = world
    attachController(world)
    const editIntent = createEditIntentCounter()
    const controller = createCategoryController({
      ...doubles(world),
      onChange: () => {},
      editIntent,
      getAdminData: () => world.ctx.adminData,
      setRootError: () => {},
      setCurrentView: () => {},
      setHomeFocusCategoryId: () => {},
    })
    const pending = controller.openEdit({ id: 2 })
    expect(editIntent.current()).toBe(1)
    editIntent.next() // e.g. a bookmark form opened meanwhile
    await world.release('r', { value: { ...baseAdminData(), settings: null } })
    await pending
    expect(controller.getState().modalOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// legacy：逐字复刻拆分前 App.svelte（HEAD 6b9e027）的分类代码。
// 仅做机械替换：App 作用域变量 → `app.xxx`，模块级依赖 → 世界替身
// （api / lazyComponents / dataService / tick / requestConfirmation / handleOpenLogin /
// ensureLoggedInDataLoaded / refreshAdminDataAfterMutation → 同名替身），控制流与语句顺序不变。
// ---------------------------------------------------------------------------

function attachLegacy(w: World): Impl {
  const d = doubles(w)
  const app = {
    rootError: '',
    currentView: 'home' as AppView,
    categoryModalOpen: false,
    categoryCreateReturnToHome: false,
    homeFocusCategoryId: null as number | null,
    categoryModalMode: 'create' as 'create' | 'edit',
    activeCategory: null as Partial<CategoryFormValue> | null,
    editIntent: 0,
    savingCategory: false,
    deletingCategoryId: null as number | null,
    categoryError: '',
  }
  const api = d.api
  const lazyComponents = { ensure: d.ensureLazyComponent }
  const { isLoggedIn, readAdminDataForEdit, applyLocalCategoryUpsert, applyLocalCategoryDelete, applyLocalCategorySort, persistCurrentAdminData, refreshLoggedInData, tick } = d
  const handleOpenLogin = d.openLogin
  const ensureLoggedInDataLoaded = d.ensureLoggedInDataLoaded
  const refreshAdminDataAfterMutation = d.refreshAdminDataAfterMutation
  const requestConfirmation = d.requestConfirmation
  const categorySortState = createOptimisticSortState()

  function resetCategoryState(): void {
    app.editIntent += 1
    app.categoryModalOpen = false
    app.categoryModalMode = 'create'
    app.activeCategory = null
    app.categoryError = ''
    app.savingCategory = false
    app.categoryCreateReturnToHome = false
  }

  async function openCreateCategoryUseCase(returnToHome: boolean): Promise<boolean> {
    app.editIntent += 1
    if (!isLoggedIn()) {
      await handleOpenLogin()
      return false
    }

    if (!await ensureLoggedInDataLoaded()) {
      return false
    }

    if (returnToHome) await lazyComponents.ensure('CategoryEditModal')
    else await lazyComponents.ensure('Admin')
    return true
  }
  async function handleOpenCreateCategory(parentId: string | number | null = null, returnToHomeOverride: boolean | undefined = undefined): Promise<void> {
    const returnToHome = returnToHomeOverride ?? parentId != null
    if (!await openCreateCategoryUseCase(returnToHome)) return

    app.categoryError = ''
    app.categoryCreateReturnToHome = returnToHome
    app.categoryModalMode = 'create'
    app.activeCategory = createCategoryDraft(parentId)
    app.categoryModalOpen = true
    if (!returnToHome) app.currentView = 'admin'
  }
  async function handleOpenCreateRootCategory(): Promise<void> {
    await handleOpenCreateCategory(null, true)
  }

  async function openEditCategoryUseCase(category: { id: string | number }): Promise<void> {
    const intent = ++app.editIntent
    try {
      const data = await readAdminDataForEdit()
      if (!data || intent !== app.editIntent) return
      const current = data.categories.find(item => item.id === Number(category.id))
      if (!current) throw new Error('分类已不存在，请刷新后重试。')
      app.categoryError = ''
      app.categoryModalMode = 'edit'
      app.activeCategory = toCategoryForm(current)
      app.categoryModalOpen = true
    } catch (error) {
      if (intent === app.editIntent) app.rootError = `无法读取分类的原始编辑数据：${getErrorMessage(error)}`
    }
  }
  async function handleEditCategory(category: { id: string | number }): Promise<void> {
    await openEditCategoryUseCase(category)
  }

  async function handleCloseCategoryModal(): Promise<void> {
    resetCategoryState()
  }

  async function submitCategoryUseCase(form: CategoryFormValue): Promise<void> {
    const returnToHome = app.categoryCreateReturnToHome
    const isEdit = form.id != null
    app.savingCategory = true
    app.categoryError = ''

    await runAdminMutation({
      run: () =>
        isEdit
          ? api.categories.update(Number(form.id), toCategoryPayload(form))
          : api.categories.create(toCategoryPayload(form)),
      onSuccess: async (category) => {
        resetCategoryState()
        await applyLocalCategoryUpsert(category)
        await refreshAdminDataAfterMutation()
        if (returnToHome) {
          app.currentView = 'home'
          app.homeFocusCategoryId = null
          await tick()
          app.homeFocusCategoryId = category.id
          await tick()
        }
      },
      successMessage: (category) =>
        isEdit ? `分类「${category.title}」已更新` : `分类「${category.title}」已创建`,
      onError: (message) => {
        app.categoryError = message
      },
      onSettled: () => {
        app.savingCategory = false
      },
    })
  }
  async function handleSubmitCategory(form: CategoryFormValue): Promise<void> {
    await submitCategoryUseCase(form)
  }

  async function handleDeleteCategory(category: { id: string | number; title: string }): Promise<void> {
    const adminData = w.ctx.adminData
    const categoryId = Number(category.id)
    const directBookmarkCount = adminData.bookmarks.filter((bookmark) => bookmark.category_id === categoryId).length
    const childCategoryCount = adminData.categories.filter((item) => item.parent_id === categoryId).length
    const confirmed = await requestConfirmation(createDeleteCategoryConfirmation(
      category.title,
      directBookmarkCount,
      childCategoryCount,
    ))
    if (!confirmed) return

    app.deletingCategoryId = categoryId
    app.categoryError = ''

    await runAdminMutation({
      run: () => api.categories.remove(categoryId),
      onSuccess: async () => {
        await applyLocalCategoryDelete(categoryId)
        await refreshAdminDataAfterMutation()
      },
      successMessage: () => `分类「${category.title}」已删除`,
      onError: (message) => {
        app.categoryError = message
      },
      onSettled: () => {
        app.deletingCategoryId = null
      },
    })
  }

  async function handleBatchDeleteCategories(ids: number[]): Promise<void> {
    const adminData = w.ctx.adminData
    if (ids.length === 0) return
    const bookmarkCount = adminData.bookmarks.filter((bookmark) => ids.includes(bookmark.category_id)).length
    const childCategoryCount = adminData.categories.filter((category) => (
      category.parent_id != null && ids.includes(category.parent_id)
    )).length
    if (!await requestConfirmation(createBatchDeleteConfirmation('category', ids.length, bookmarkCount, childCategoryCount))) return

    await runAdminMutation({
      run: () => api.categories.batchDelete(ids),
      onSuccess: async (result) => {
        if (result.deleted > 0 || result.deleted_bookmarks > 0) await refreshAdminDataAfterMutation()
      },
      successMessage: (result) => `已删除 ${result.deleted} 个分类及 ${result.deleted_bookmarks} 个书签`,
      onError: (message) => {
        app.categoryError = message
      },
    })
  }

  async function handleSortCategories(parentId: number | null, ids: Array<string | number>): Promise<void> {
    app.categoryError = ''

    await runOptimisticSort(categorySortState, ids, {
      applyLocalSort: (sortedIds) => applyLocalCategorySort(parentId, sortedIds, false),
      saveRemoteSort: (sortedIds) => api.categories.sort(parentId, sortedIds),
      persist: persistCurrentAdminData,
      onSuccess: refreshAdminDataAfterMutation,
      restoreOnError: () => refreshLoggedInData(true),
      onError: (error) => {
        app.categoryError = getErrorMessage(error)
      },
    })
  }

  const impl: Impl = {
    openCreate: handleOpenCreateCategory,
    openCreateRoot: handleOpenCreateRootCategory,
    openEdit: handleEditCategory,
    close: handleCloseCategoryModal,
    submit: handleSubmitCategory,
    remove: handleDeleteCategory,
    batchRemove: handleBatchDeleteCategories,
    sort: handleSortCategories,
    reset: resetCategoryState,
    bumpIntent: () => { app.editIntent += 1 },
    read: () => ({
      modalOpen: app.categoryModalOpen,
      modalMode: app.categoryModalMode,
      active: app.activeCategory,
      saving: app.savingCategory,
      deletingId: app.deletingCategoryId,
      error: app.categoryError,
      createReturnToHome: app.categoryCreateReturnToHome,
      editIntent: app.editIntent,
      rootError: app.rootError,
      currentView: app.currentView,
      homeFocusCategoryId: app.homeFocusCategoryId,
    }),
  }
  w.impl = impl
  return impl
}
