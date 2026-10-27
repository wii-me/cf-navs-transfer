// 写路由的统一收尾：按收据做提交后的缓存失效，并把新 data_version 附在响应包络上。
//
// 之前约 15 个写路由各自重复「touchDataVersion + 运行时缓存失效 +
// invalidatePublicDataCache」，漏一处就会出现「数据变了缓存没失效」。现在版本提升在
// db 层与业务写入同一 batch 提交（见 db/mutation.ts），路由只需把收据交给这里。

import { invalidatePublicDataCache, invalidateSiteConfigCache } from './cache'
import type { MutationReceipt } from './db/mutation'
import { ok } from './response'
import type { AppContext } from './routeHelpers'

export interface MutationInvalidationOptions {
  /** 站点标题 / 公开模式可能变化（设置保存、覆盖导入）时一并失效 `/api/config` edge cache。 */
  siteConfig?: boolean
}

/** 收据显示版本确实提升时才失效；未写入任何数据（404、集合全部不存在）不打穿缓存。 */
export function invalidateAfterMutation(
  c: AppContext,
  receipt: MutationReceipt,
  options: MutationInvalidationOptions = {},
): void {
  if (!receipt.data_version) return
  invalidatePublicDataCache(c, c.req.url)
  if (options.siteConfig) invalidateSiteConfigCache(c, c.req.url)
}

/**
 * 成功写响应：`{ code: 0, msg, data, data_version? }`。`data_version` 是包络上的
 * 附加字段（只在本次请求确实提升了版本时出现），旧前端忽略未知字段即可，
 * 不改变 `data` 的形状。
 */
export function mutationJson<T>(
  c: AppContext,
  data: T,
  receipt: MutationReceipt,
  options: MutationInvalidationOptions & { headers?: Record<string, string> } = {},
): Response {
  invalidateAfterMutation(c, receipt, options)
  const body = receipt.data_version ? { ...ok(data), data_version: receipt.data_version } : ok(data)
  return c.json(body, 200, options.headers)
}
