// 路由层共用的小工具。
//
// 抽出来的原因：`badRequest` 在 5 个路由文件里各写一遍，`readJson` 4 遍，
// `AppContext` 别名 5 遍，`parseId` / `isNonEmptyString` / `isOptionalString` /
// `parseBatchIds` 各 2 遍。都是同步纯函数，构建后是同一份代码，
// 集中维护不增加任何 CPU 或挂钟成本。

import type { Context } from 'hono'
import { ErrCode } from '../../shared/types'
import { fail } from './response'
import type { HonoEnv } from '../types'

export type AppContext = Context<HonoEnv>

// 批量操作的 id 上限。超过这个量级的请求要么是误操作，要么是刻意压测，
// 放行只会把 Worker CPU 和 D1 语句配额打光。
export const MAX_BATCH_IDS = 500

/**
 * 参数 / 业务校验失败：**HTTP 200** + `code=1002`。刻意不用 HTTP 400——项目约定业务错误
 * 走包络 `code`（前端 `request()` 与浏览器扩展都按 `code !== 0` 判错），真实 HTTP 状态只留给
 * 鉴权 401、跨域 403 与少数需要 HTTP 语义的端点（错误上报、点击计数、图标副本、Iconify 搜索）。完整约定表见 API_CONTRACT「错误码与 HTTP 状态约定」。
 */
export function badRequest(c: AppContext, msg: string) {
  return c.json(fail(ErrCode.BAD_REQUEST, msg))
}

/**
 * 路由 catch 的统一收尾（默认 HTTP 200 + `code=1500`；只有显式传 `500` 时返回真实 500）：客户端只拿到通用的 `code=1500` + msg，原始错误写进 Workers 日志
 * （`[api] <msg>: <error>`），避免「接口报 1500、日志里什么都没有」。
 */
export function serverError(c: AppContext, msg: string, error: unknown, status?: 500) {
  console.error(`[api] ${msg}:`, error)
  return status ? c.json(fail(ErrCode.SERVER_ERROR, msg), status) : c.json(fail(ErrCode.SERVER_ERROR, msg))
}

export async function readJson<T>(c: AppContext): Promise<T | null> {
  try {
    return await c.req.json<T>()
  } catch {
    return null
  }
}

export function parseId(c: AppContext): number | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) && id > 0 ? id : null
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

export function parseBatchIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_IDS) return null
  const ids = [...new Set(value)]
  return ids.length > 0 && ids.every((id) => Number.isInteger(id) && id > 0) ? ids as number[] : null
}

// 排序请求提交的是整个作用域的完整兄弟集合，所以上限比批量删除宽得多，
// 但仍然要有上限：之前完全不限长度，一次超大 payload 就能打爆 CPU 和 D1。
export const MAX_SORT_IDS = 5000

export function parseSortIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_SORT_IDS) return null
  return value.every((id) => Number.isInteger(id) && id > 0) ? value as number[] : null
}
