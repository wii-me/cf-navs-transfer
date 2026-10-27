import { Hono } from 'hono'
import type { ChangePasswordReq, LoginReq, LogoutResp } from '../../shared/types'
import { ErrCode } from '../../shared/types'
import {
  authRequired,
  clearAllCachedSessions,
  clearAllSessions,
  clearCachedSession,
  extractBearerToken,
} from '../middleware/auth'
import { clearLoginFailures, getClientIp, loginRateLimit, recordLoginFailure } from '../middleware/rateLimit'
import { ensureAdminBootstrap, type AdminCredentials } from '../lib/bootstrap'
import { hashPassword, verifyPassword } from '../lib/crypto'
import { fail, ok } from '../lib/response'
import { createSession } from '../lib/session'
import { revokeSession } from '../lib/sessionRevocation'
import { hasSessionBinding } from '../lib/sessionStore'
import type { HonoEnv } from '../types'
import { serverError } from '../lib/routeHelpers'

const ADMIN_PASSWORD_KEY = 'admin_password'
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256

export { getSessionTtlSeconds } from '../lib/session'

export function isValidNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH
}

// 公开：登录。受保护：登出、改密码、当前用户——worker/index.ts 把它们挂进统一
// authRequired 的受保护子应用；逐路由的 authRequired 保留为纵深防御（幂等，不重复校验）。
export const authPublicRoutes = new Hono<HonoEnv>()
export const authProtectedRoutes = new Hono<HonoEnv>()

authPublicRoutes.post('/login', loginRateLimit, async (c) => {
  let credentials: AdminCredentials
  try {
    credentials = await ensureAdminBootstrap(c.env)
  } catch (error) {
    return serverError(c, 'admin bootstrap failed', error)
  }

  let body: LoginReq
  try {
    body = await c.req.json<LoginReq>()
  } catch {
    return c.json(fail(ErrCode.BAD_REQUEST, 'invalid request body'))
  }

  const username = body.username?.trim()
  const password = body.password
  if (!username || !password) {
    return c.json(fail(ErrCode.BAD_REQUEST, 'username and password are required'))
  }

  const ip = getClientIp(c)
  const passwordOk = username === credentials.username && (await verifyPassword(password, credentials.passwordHash))
  if (!passwordOk) {
    await recordLoginFailure(c.env, ip, c.get('loginRateLimitState'))
    return c.json(fail(ErrCode.UNAUTHORIZED, 'invalid credentials'))
  }

  const loginRateLimitState = c.get('loginRateLimitState')

  if (credentials.resetApplied) {
    await clearAllSessions(c.env)
    clearAllCachedSessions()
  }

  const sessionPromise = createSession(c.env, credentials.username)
  const loginFailurePromise = loginRateLimitState
    ? clearLoginFailures(c.env, ip)
    : Promise.resolve()
  const [data] = await Promise.all([sessionPromise, loginFailurePromise])
  return c.json(ok(data))
})

authProtectedRoutes.post('/logout', authRequired, async (c) => {
  // authRequired 已经校验过 token，这里只是取回原始串用于写撤销名单。
  const token = extractBearerToken(c.req.header('Authorization'))
  if (!token) {
    return c.json(fail(ErrCode.UNAUTHORIZED, 'unauthorized'), 401)
  }

  // 清内存缓存只影响当前 isolate，JWT 本身在 exp 之前照样有效。
  // 必须写撤销名单，否则「退出登录」在共享设备上等于什么都没做。
  //
  // `store_unconfigured` 在 PROB-31 之后仍然可达，但只在一个很窄的窗口里：
  // `validateSession` 的 isolate 内存缓存命中时会提前返回，不再复查绑定，所以「绑定存在
  // 时验过并缓存 → 绑定被移除 → 15 秒内 logout」这条路径能进到这里。缓存过期后
  // `authRequired` 就会直接 401，不会再走到这个分支。
  let result: LogoutResp
  if (!hasSessionBinding(c.env)) {
    result = { revoked: false, reason: 'store_unconfigured' }
  } else {
    try {
      await revokeSession(c.env.SESSION, token, c.get('sessionExpiresAt'))
      result = { revoked: true }
    } catch {
      // KV 不可用时不让退出登录失败：前端仍要清本地登录态，token 也只是回到
      // 加这层之前的状态。但不能再谎称撤销成功——调用方需要能分辨这种情况，
      // 否则共享设备上的用户会以为已经退出，而 token 还能用到 exp。
      result = { revoked: false, reason: 'store_unavailable' }
    }
  }

  clearCachedSession(token)
  return c.json(ok(result))
})

authProtectedRoutes.post('/password', authRequired, async (c) => {
  let body: ChangePasswordReq
  try {
    body = await c.req.json<ChangePasswordReq>()
  } catch {
    return c.json(fail(ErrCode.BAD_REQUEST, 'invalid request body'))
  }

  if (typeof body.current_password !== 'string' || !body.current_password) {
    return c.json(fail(ErrCode.BAD_REQUEST, 'current password is required'))
  }

  if (!isValidNewPassword(body.new_password)) {
    return c.json(fail(ErrCode.BAD_REQUEST, `new password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`))
  }

  let credentials: AdminCredentials
  try {
    credentials = await ensureAdminBootstrap(c.env, { applyCredentialReset: false })
  } catch (error) {
    return serverError(c, 'admin bootstrap failed', error)
  }

  const currentPasswordOk = await verifyPassword(body.current_password, credentials.passwordHash)
  if (!currentPasswordOk) {
    return c.json(fail(ErrCode.BAD_REQUEST, 'current password is incorrect'))
  }

  try {
    // 新密码与新的 JWT 签名密钥同一条语句写入：要么都生效，要么都不生效。
    await clearAllSessions(c.env, [[ADMIN_PASSWORD_KEY, await hashPassword(body.new_password)]])
    clearAllCachedSessions()
    return c.json(ok(null))
  } catch (error) {
    return serverError(c, 'failed to update password', error)
  }
})

authProtectedRoutes.get('/me', authRequired, (c) => {
  return c.json(ok({ username: c.get('username') }))
})

/** 两组合并的完整认证路由（单测与独立挂载用）。 */
export const authRoutes = new Hono<HonoEnv>()
authRoutes.route('/', authPublicRoutes)
authRoutes.route('/', authProtectedRoutes)

export default authRoutes
