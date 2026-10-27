import { getSettingValues, setSettingValue, setSettingValues } from './db/settings'

const JWT_SECRET_KEY = 'jwt_secret'

// 每个 isolate 只缓存签名密钥一小段时间。`rotateJwtSecret`（改密码、凭据重置、/recover）
// 只能更新**当前** isolate 的内存；若缓存永不过期，其它 isolate 会一直接受旧密钥签出的
// token，「轮换即作废全部会话」就不成立。TTL 与 session 内存缓存（15 秒）对齐，
// 跨 isolate 的失效窗口因此与 logout 的既有窗口一致。
export const JWT_SECRET_CACHE_TTL_MS = 15_000
// 校验失败时允许按需重读一次 D1（新密钥签出的 token 打到旧 isolate），但同一 isolate
// 两次重读至少间隔这么久，避免伪造 token 被用来放大 D1 读。
export const JWT_SECRET_REFRESH_MIN_INTERVAL_MS = 1_000

let cachedJwtSecret: { value: string; loadedAt: number } | null = null

export function resetJwtSecretCache(): void {
  cachedJwtSecret = null
}

function cacheSecret(value: string): string {
  cachedJwtSecret = { value, loadedAt: Date.now() }
  return value
}

// Helper to encode Uint8Array to Base64URL
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

// Helper to decode Base64URL string to Uint8Array
function decodeBase64url(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Retrieve or dynamically generate the JWT signing secret from D1 settings
export async function getJwtSecret(db: D1Database): Promise<string> {
  if (cachedJwtSecret && Date.now() - cachedJwtSecret.loadedAt < JWT_SECRET_CACHE_TTL_MS) {
    return cachedJwtSecret.value
  }
  return loadJwtSecret(db)
}

async function loadJwtSecret(db: D1Database): Promise<string> {
  const values = await getSettingValues<string>(db, [JWT_SECRET_KEY])
  let secret = values.get(JWT_SECRET_KEY)

  if (!secret || typeof secret !== 'string') {
    const buffer = new Uint8Array(32)
    crypto.getRandomValues(buffer)
    secret = Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    await setSettingValue(db, JWT_SECRET_KEY, secret)
  }

  return cacheSecret(secret)
}

/**
 * 校验失败后调用：若缓存的密钥已超过最小重读间隔，从 D1 重读一次。
 * 只有读到的密钥与缓存不同才返回新密钥，调用方据此决定是否用新密钥重试一次校验；
 * 返回 null 表示没有可重试的新密钥。
 */
export async function refreshJwtSecretAfterVerifyFailure(db: D1Database): Promise<string | null> {
  const previous = cachedJwtSecret
  if (previous && Date.now() - previous.loadedAt < JWT_SECRET_REFRESH_MIN_INTERVAL_MS) return null
  const next = await loadJwtSecret(db)
  return previous && next !== previous.value ? next : null
}

// Rotate the JWT secret to invalidate all active JWT sessions globally
/**
 * 轮换签名密钥（作废全部会话）。`alsoWrite` 中的设置与新密钥写在**同一条** upsert 里：
 * 改密码 / 凭据恢复必须「新密码生效」与「旧会话作废」同生共死——之前分两次写，
 * 第二步失败会留下「密码已改、旧 token 仍然有效」的状态。
 */
export async function rotateJwtSecret(
  db: D1Database,
  alsoWrite: ReadonlyArray<readonly [key: string, value: unknown]> = [],
): Promise<string> {
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)
  const secret = Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  await setSettingValues(db, [[JWT_SECRET_KEY, secret], ...alsoWrite])
  return cacheSecret(secret)
}

// Sign a JWT payload using HMAC SHA-256
export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const header = { alg: 'HS256', typ: 'JWT' }

  const headerPart = base64url(encoder.encode(JSON.stringify(header)))
  const payloadPart = base64url(encoder.encode(JSON.stringify(payload)))
  const message = `${headerPart}.${payloadPart}`

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  )

  return `${message}.${base64url(new Uint8Array(signature))}`
}

// Verify a JWT token signature and return the decoded payload if valid
export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerPart, payloadPart, signaturePart] = parts
  const message = `${headerPart}.${payloadPart}`
  const encoder = new TextEncoder()

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signature = decodeBase64url(signaturePart)
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(message)
    )

    if (!isValid) return null

    const payloadBytes = decodeBase64url(payloadPart)
    const payloadStr = new TextDecoder().decode(payloadBytes)
    return JSON.parse(payloadStr) as Record<string, unknown>
  } catch {
    return null
  }
}
