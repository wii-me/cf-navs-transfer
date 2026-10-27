import type { AdminData, BatchDeleteCategoriesResp, Category, CategoryUpsertReq } from '../../shared/types'
import { getErrorMessage } from './api'
import { toCategoryForm, toCategoryPayload } from './adminFormAdapters'
import type { CategoryFormValue } from './adminTypes'
import { runAdminMutation } from './appAdminMutation'
import {
  createBatchDeleteConfirmation,
  createDeleteCategoryConfirmation,
  type ConfirmDialogInput,
} from './appConfirmDialog'
import type { EditIntentCounter } from './appEditIntent'
import { createCategoryDraft } from './appModalState'
import type { AppView } from './appNavigation'
import { createOptimisticSortState, runOptimisticSort } from './appSortQueue'

// 分类的打开 / 编辑 / 提交 / 删除 / 批量删除 / 排序与表单状态（App.svelte 拆分第 7a 步，代码审查三轮第 14 项）。
//
// 与 appConfirmDialog / appBootController 一样用普通闭包而非 store：控制器持有分类编辑框的状态，
// 每次赋值后把整份快照交给 `onChange`，App 再赋给模板用的变量（不新增 store 订阅）。
// 与书签共用的编辑意图计数器经 `editIntent` 注入；rootError / currentView / 首页聚焦分类仍归 App，
// 通过回调在原先完全相同的时机写入。语句顺序与 await 位置与原 App 实现逐条一致。

export interface CategoryEditorState {
  modalOpen: boolean
  modalMode: 'create' | 'edit'
  active: Partial<CategoryFormValue> | null
  saving: boolean
  deletingId: number | null
  error: string
  /** 新建框是从首页打开的：保存后回到首页并聚焦新分类（也决定首页是否挂载 CategoryEditModal）。 */
  createReturnToHome: boolean
}

export interface CategoryControllerDeps {
  onChange: (state: CategoryEditorState) => void
  editIntent: EditIntentCounter
  api: {
    categories: {
      create: (payload: CategoryUpsertReq) => Promise<Category>
      update: (id: number, payload: CategoryUpsertReq) => Promise<Category>
      remove: (id: number) => Promise<unknown>
      batchDelete: (ids: number[]) => Promise<BatchDeleteCategoriesResp>
      sort: (parentId: number | null, ids: number[]) => Promise<unknown>
    }
  }
  isLoggedIn: () => boolean
  openLogin: () => Promise<void>
  ensureLoggedInDataLoaded: () => Promise<boolean>
  ensureLazyComponent: (name: 'CategoryEditModal' | 'Admin') => Promise<unknown>
  readAdminDataForEdit: () => Promise<AdminData | null>
  /** App 的响应式 `adminData`（删除确认文案里的书签 / 子分类数量按它统计）。 */
  getAdminData: () => Pick<AdminData, 'categories' | 'bookmarks'>
  requestConfirmation: (input: ConfirmDialogInput) => Promise<boolean>
  applyLocalCategoryUpsert: (category: Category) => Promise<void>
  applyLocalCategoryDelete: (categoryId: number) => Promise<void>
  applyLocalCategorySort: (parentId: number | null, ids: number[], refreshMissing?: boolean) => Promise<void>
  persistCurrentAdminData: () => Promise<void>
  refreshAdminDataAfterMutation: () => Promise<void>
  /** 写入结果已用服务端返回值应用到本地之后调用：只确认版本，期间有别的写入才整包重拉。 */
  confirmAdminDataAfterLocalMutation: () => Promise<void>
  refreshLoggedInData: (force?: boolean) => Promise<void>
  setRootError: (message: string) => void
  setCurrentView: (view: AppView) => void
  setHomeFocusCategoryId: (id: number | null) => void
  tick: () => Promise<void>
}

export interface CategoryController {
  getState: () => CategoryEditorState
  /** 关闭并清空分类编辑框（同时推进编辑意图）；登出 / 改密时也会调用。 */
  reset: () => void
  openCreate: (parentId?: string | number | null, returnToHomeOverride?: boolean) => Promise<void>
  openCreateRoot: () => Promise<void>
  openEdit: (category: { id: string | number }) => Promise<void>
  close: () => Promise<void>
  submit: (form: CategoryFormValue) => Promise<void>
  remove: (category: { id: string | number; title: string }) => Promise<void>
  batchRemove: (ids: number[]) => Promise<void>
  sort: (parentId: number | null, ids: Array<string | number>) => Promise<void>
}

export function createCategoryController(deps: CategoryControllerDeps): CategoryController {
  const { editIntent } = deps
  let modalOpen = false
  let modalMode: 'create' | 'edit' = 'create'
  let active: Partial<CategoryFormValue> | null = null
  let saving = false
  let deletingId: number | null = null
  let error = ''
  let createReturnToHome = false
  const sortState = createOptimisticSortState()

  function getState(): CategoryEditorState {
    return { modalOpen, modalMode, active, saving, deletingId, error, createReturnToHome }
  }

  function emit(): void {
    deps.onChange(getState())
  }

  function reset(): void {
    editIntent.next()
    modalOpen = false
    modalMode = 'create'
    active = null
    error = ''
    saving = false
    createReturnToHome = false
    emit()
  }

  async function openCreateUseCase(returnToHome: boolean): Promise<boolean> {
    editIntent.next()
    if (!deps.isLoggedIn()) {
      await deps.openLogin()
      return false
    }

    if (!await deps.ensureLoggedInDataLoaded()) {
      return false
    }

    if (returnToHome) await deps.ensureLazyComponent('CategoryEditModal')
    else await deps.ensureLazyComponent('Admin')
    return true
  }

  async function openCreate(parentId: string | number | null = null, returnToHomeOverride: boolean | undefined = undefined): Promise<void> {
    const returnToHome = returnToHomeOverride ?? parentId != null
    if (!await openCreateUseCase(returnToHome)) return

    error = ''
    createReturnToHome = returnToHome
    modalMode = 'create'
    active = createCategoryDraft(parentId)
    modalOpen = true
    emit()
    if (!returnToHome) deps.setCurrentView('admin')
  }

  async function openEdit(category: { id: string | number }): Promise<void> {
    const intent = editIntent.next()
    try {
      const data = await deps.readAdminDataForEdit()
      if (!data || intent !== editIntent.current()) return
      const current = data.categories.find(item => item.id === Number(category.id))
      if (!current) throw new Error('分类已不存在，请刷新后重试。')
      error = ''
      modalMode = 'edit'
      active = toCategoryForm(current)
      modalOpen = true
      emit()
    } catch (caught) {
      if (intent === editIntent.current()) deps.setRootError(`无法读取分类的原始编辑数据：${getErrorMessage(caught)}`)
    }
  }

  async function submit(form: CategoryFormValue): Promise<void> {
    const returnToHome = createReturnToHome
    // 提交意图只看表单本身。`reset()` 会把 modalMode 改回 'create'，
    // 在它之后再读 mode 就会让编辑也提示「已创建」——这条提示语曾经一直是「已创建」。
    const isEdit = form.id != null
    saving = true
    error = ''
    emit()

    await runAdminMutation({
      run: () =>
        isEdit
          ? deps.api.categories.update(Number(form.id), toCategoryPayload(form))
          : deps.api.categories.create(toCategoryPayload(form)),
      onSuccess: async (category) => {
        reset()
        await deps.applyLocalCategoryUpsert(category)
        await deps.confirmAdminDataAfterLocalMutation()
        if (returnToHome) {
          deps.setCurrentView('home')
          deps.setHomeFocusCategoryId(null)
          await deps.tick()
          deps.setHomeFocusCategoryId(category.id)
          await deps.tick()
        }
      },
      successMessage: (category) =>
        isEdit ? `分类「${category.title}」已更新` : `分类「${category.title}」已创建`,
      onError: (message) => {
        error = message
        emit()
      },
      onSettled: () => {
        saving = false
        emit()
      },
    })
  }

  async function deleteCategory(category: { id: string | number; title: string }): Promise<void> {
    const categoryId = Number(category.id)
    const directBookmarkCount = deps.getAdminData().bookmarks.filter((bookmark) => bookmark.category_id === categoryId).length
    const childCategoryCount = deps.getAdminData().categories.filter((item) => item.parent_id === categoryId).length
    const confirmed = await deps.requestConfirmation(createDeleteCategoryConfirmation(
      category.title,
      directBookmarkCount,
      childCategoryCount,
    ))
    if (!confirmed) return

    deletingId = categoryId
    error = ''
    emit()

    await runAdminMutation({
      run: () => deps.api.categories.remove(categoryId),
      onSuccess: async () => {
        await deps.applyLocalCategoryDelete(categoryId)
        await deps.confirmAdminDataAfterLocalMutation()
      },
      successMessage: () => `分类「${category.title}」已删除`,
      onError: (message) => {
        error = message
        emit()
      },
      onSettled: () => {
        deletingId = null
        emit()
      },
    })
  }

  async function batchRemove(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    const adminData = deps.getAdminData()
    const bookmarkCount = adminData.bookmarks.filter((bookmark) => ids.includes(bookmark.category_id)).length
    const childCategoryCount = adminData.categories.filter((category) => (
      category.parent_id != null && ids.includes(category.parent_id)
    )).length
    if (!await deps.requestConfirmation(createBatchDeleteConfirmation('category', ids.length, bookmarkCount, childCategoryCount))) return

    await runAdminMutation({
      run: () => deps.api.categories.batchDelete(ids),
      onSuccess: async (result) => {
        if (result.deleted > 0 || result.deleted_bookmarks > 0) await deps.refreshAdminDataAfterMutation()
      },
      successMessage: (result) => `已删除 ${result.deleted} 个分类及 ${result.deleted_bookmarks} 个书签`,
      onError: (message) => {
        error = message
        emit()
      },
    })
  }

  async function sort(parentId: number | null, ids: Array<string | number>): Promise<void> {
    error = ''
    emit()

    await runOptimisticSort(sortState, ids, {
      applyLocalSort: (sortedIds) => deps.applyLocalCategorySort(parentId, sortedIds, false),
      saveRemoteSort: (sortedIds) => deps.api.categories.sort(parentId, sortedIds),
      persist: deps.persistCurrentAdminData,
      onSuccess: deps.confirmAdminDataAfterLocalMutation,
      restoreOnError: () => deps.refreshLoggedInData(true),
      onError: (caught) => {
        error = getErrorMessage(caught)
        emit()
      },
    })
  }

  return {
    getState,
    reset,
    openCreate,
    // 下面三个与原 App 处理器一样再包一层 async（handleOpenCreateRootCategory / handleEditCategory /
    // handleSubmitCategory），兑现时机逐个微任务保持一致。
    async openCreateRoot() {
      await openCreate(null, true)
    },
    async openEdit(category) {
      await openEdit(category)
    },
    async close() {
      reset()
    },
    async submit(form) {
      await submit(form)
    },
    remove: deleteCategory,
    batchRemove,
    sort,
  }
}
