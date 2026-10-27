import { Hono } from 'hono'
import { ErrCode, type BatchDeleteReq, type CategorySortReq, type CategoryUpsertReq } from '../../shared/types'
import {
  CategoryConflictError,
  CategoryValidationError,
  createCategory,
  deleteCategory,
  batchDeleteCategories,
  listCategories,
  sortCategories,
  updateCategory,
} from '../lib/db'
import { createMutationReceipt } from '../lib/db/mutation'
import { mutationJson } from '../lib/mutationResponse'
import { fail, ok } from '../lib/response'
import {
  badRequest,
  isNonEmptyString,
  isOptionalString,
  parseBatchIds,
  parseId,
  parseSortIds,
  readJson,
  type AppContext,
  serverError,
} from '../lib/routeHelpers'
import type { HonoEnv } from '../types'

function parseParentId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

export const categoriesRoutes = new Hono<HonoEnv>()

function categoryWriteError(c: AppContext, error: unknown, fallback: string) {
  if (error instanceof CategoryValidationError) return badRequest(c, error.message)
  if (error instanceof CategoryConflictError) return c.json(fail(ErrCode.CONFLICT, error.message))
  return serverError(c, fallback, error)
}

categoriesRoutes.get('/', async (c) => {
  try {
    return c.json(ok(await listCategories(c.env.DB)))
  } catch (error) {
    return serverError(c, 'failed to list categories', error)
  }
})

categoriesRoutes.post('/', async (c) => {
  const body = await readJson<CategoryUpsertReq>(c)
  const parentId = parseParentId(body?.parent_id)
  if (!body || !isNonEmptyString(body.title) || !isOptionalString(body.icon) ||
      (body.parent_id !== undefined && parentId === undefined) ||
      (body.is_private !== undefined && typeof body.is_private !== 'boolean')) {
    return badRequest(c, 'invalid category payload')
  }

  try {
    const receipt = createMutationReceipt()
    const category = await createCategory(c.env.DB, {
      title: body.title.trim(),
      icon: body.icon ?? null,
      parent_id: parentId ?? null,
      is_private: body.is_private === true,
    }, receipt)
    return mutationJson(c, category, receipt)
  } catch (error) {
    return categoryWriteError(c, error, 'failed to create category')
  }
})

categoriesRoutes.put('/:id', async (c) => {
  const id = parseId(c)
  if (id == null) return badRequest(c, 'invalid category id')

  const body = await readJson<CategoryUpsertReq>(c)
  const parentId = parseParentId(body?.parent_id)
  if (!body || !isNonEmptyString(body.title) || !isOptionalString(body.icon) ||
      (body.parent_id !== undefined && parentId === undefined) ||
      (body.is_private !== undefined && typeof body.is_private !== 'boolean')) {
    return badRequest(c, 'invalid category payload')
  }

  try {
    const receipt = createMutationReceipt()
    const category = await updateCategory(c.env.DB, id, {
      title: body.title.trim(),
      icon: body.icon ?? null,
      parent_id: body.parent_id === undefined ? undefined : parentId,
      is_private: body.is_private,
    }, receipt)
    if (!category) return c.json(fail(ErrCode.NOT_FOUND, 'category not found'))
    return mutationJson(c, category, receipt)
  } catch (error) {
    return categoryWriteError(c, error, 'failed to update category')
  }
})

categoriesRoutes.delete('/:id', async (c) => {
  const id = parseId(c)
  if (id == null) return badRequest(c, 'invalid category id')

  try {
    const receipt = createMutationReceipt()
    const deleted = await deleteCategory(c.env.DB, id, receipt)
    if (!deleted) return c.json(fail(ErrCode.NOT_FOUND, 'category not found'))
    return mutationJson(c, null, receipt)
  } catch (error) {
    return categoryWriteError(c, error, 'failed to delete category')
  }
})

categoriesRoutes.post('/batch-delete', async (c) => {
  const body = await readJson<BatchDeleteReq>(c)
  const ids = parseBatchIds(body?.ids)
  if (!ids) return badRequest(c, 'invalid batch delete payload')
  try {
    const receipt = createMutationReceipt()
    const result = await batchDeleteCategories(c.env.DB, ids, receipt)
    return mutationJson(c, result, receipt)
  } catch (error) {
    return categoryWriteError(c, error, 'failed to batch delete categories')
  }
})

categoriesRoutes.post('/sort', async (c) => {
  const body = await readJson<CategorySortReq>(c)
  const ids = parseSortIds(body?.ids)
  const parentId = parseParentId(body?.parent_id)
  if (!ids || parentId === undefined) {
    return badRequest(c, 'invalid sort payload')
  }

  try {
    const receipt = createMutationReceipt()
    await sortCategories(c.env.DB, { parent_id: parentId, ids }, receipt)
    return mutationJson(c, null, receipt)
  } catch (error) {
    return categoryWriteError(c, error, 'failed to sort categories')
  }
})

export default categoriesRoutes
