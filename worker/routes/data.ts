import { Hono } from 'hono'
import { type ImportReq, type ImportResp } from '../../shared/types'
import { getAdminData, getSettings, importData, listBookmarksWithIconBlobs, listCategories } from '../lib/db'
import { mergeImportData } from '../lib/db/importMerge'
import { validateImportPayload } from '../lib/importValidation'
import { badRequest, readJson, serverError } from '../lib/routeHelpers'
import { createMutationReceipt } from '../lib/db/mutation'
import { mutationJson } from '../lib/mutationResponse'
import type { HonoEnv } from '../types'

export const dataRoutes = new Hono<HonoEnv>()

dataRoutes.post('/import', async (c) => {
  const body = await readJson<ImportReq>(c)
  const validation = validateImportPayload(body)
  if (!validation.ok) return badRequest(c, validation.message)
  const payload = validation.payload

  try {
    const current = payload.mode === 'merge'
      ? await Promise.all([listCategories(c.env.DB), listBookmarksWithIconBlobs(c.env.DB), getSettings(c.env.DB)]).then(([categories, bookmarks, settings]) => ({ categories, bookmarks, settings }))
      : null
    const merged = current ? mergeImportData(current, payload) : null
    const receipt = createMutationReceipt()
    const result = await importData(c.env.DB, merged?.payload ?? {
      categories: payload.categories,
      bookmarks: payload.bookmarks,
      settings: payload.settings,
    }, receipt)
    // Import reconstructs IDs (including current merge mode); return its new dataset and versions.
    const data = await getAdminData(c.env.DB)
    return mutationJson<ImportResp>(c, {
      categories: payload.mode === 'merge' ? payload.categories.length : result.categories,
      bookmarks: payload.mode === 'merge' ? payload.bookmarks.length - (merged?.skippedBookmarks ?? 0) : result.bookmarks,
      data,
      mode: payload.mode ?? 'replace',
      created_categories: merged?.createdCategories ?? result.categories,
      reused_categories: merged?.reusedCategories ?? 0,
      // 合并模式跳过的重复链接，加上校验阶段因协议不合规被丢弃的条数。
      skipped_bookmarks: (merged?.skippedBookmarks ?? 0) + validation.droppedBookmarks,
    }, receipt, { siteConfig: true })
  } catch (error) {
    return serverError(c, 'failed to import data', error)
  }
})

export default dataRoutes
