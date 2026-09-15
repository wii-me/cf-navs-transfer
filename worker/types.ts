// Worker 运行时环境绑定 + Hono Variables

export interface Env {
  // Cloudflare 绑定
  DB: D1Database
  SESSION: KVNamespace
  ASSETS: Fetcher
  STORAGE?: R2Bucket
  // vars / secrets
  INIT_ADMIN_USER: string
  INIT_ADMIN_PASSWORD: string
  RESET_ADMIN_CREDENTIALS?: string
  SETUP_TOKEN?: string
  SESSION_TTL: string
}

// Hono context.set/get 的类型
export interface Variables {
  username: string
  // 认证中间件校验通过的会话过期时间。退出登录用它算撤销名单的 TTL，
  // 省掉一次重复的 JWT 校验和 KV 读取。
  sessionExpiresAt: number
  loginRateLimitState: LoginRateLimitState | null
}

// Hono 泛型环境别名
export interface HonoEnv {
  Bindings: Env
  Variables: Variables
}

// 解码后的 JWT 会话值，仅在 Hono context 与 isolate 内存缓存中使用，不直接写入 KV
export interface SessionValue {
  username: string
  exp: number // 毫秒时间戳
}

export interface LoginRateLimitState {
  count: number
  resetAt: number
}
