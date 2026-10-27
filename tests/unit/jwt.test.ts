import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JWT_SECRET_CACHE_TTL_MS,
  JWT_SECRET_REFRESH_MIN_INTERVAL_MS,
  getJwtSecret,
  refreshJwtSecretAfterVerifyFailure,
  resetJwtSecretCache,
  rotateJwtSecret,
  signJwt,
  verifyJwt,
} from '../../worker/lib/jwt'

function createFakeDb(initial: Record<string, unknown> = {}): {
  db: D1Database
  values: Map<string, string>
} {
  const values = new Map<string, string>(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)])
  )

  const db = {
    prepare(sql: string) {
      let bound: unknown[] = []
      const statement = {
        bind(...params: unknown[]) {
          bound = params
          return statement
        },
        async all() {
          const keys = bound as string[]
          return {
            results: keys.map((key) => ({ key, value: values.get(key) ?? null })),
          }
        },
        async run() {
          if (sql.includes('INSERT INTO settings')) {
            values.set(String(bound[0]), String(bound[1]))
          }
          return { success: true }
        },
      }
      return statement
    },
  } as unknown as D1Database

  return { db, values }
}

describe('JWT stateless authentication utilities', () => {
  it('signs and verifies JWT tokens correctly', async () => {
    const secret = 'super-secret-key-1234567890-test'
    const payload = { username: 'admin', exp: Date.now() + 10000 }

    const token = await signJwt(payload, secret)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

    const verified = await verifyJwt(token, secret)
    expect(verified).toEqual(payload)
  })

  it('fails verification with tampered signatures or wrong secrets', async () => {
    const secret = 'super-secret-key-1234567890-test'
    const wrongSecret = 'wrong-secret-key-1234567890-test'
    const payload = { username: 'admin', exp: Date.now() + 10000 }

    const token = await signJwt(payload, secret)

    // Test verification with incorrect secret
    const verifiedWrongSecret = await verifyJwt(token, wrongSecret)
    expect(verifiedWrongSecret).toBeNull()

    // Test verification with tampered token
    const tamperedToken = token.slice(0, -3) + 'abc'
    const verifiedTampered = await verifyJwt(tamperedToken, secret)
    expect(verifiedTampered).toBeNull()
  })

  it('retrieves, generates, and rotates signing secrets in D1 database settings', async () => {
    const { db, values } = createFakeDb()

    // Key should not exist in initial mock db
    expect(values.has('jwt_secret')).toBe(false)

    // Getting secret should generate it
    const secret1 = await getJwtSecret(db)
    expect(secret1).toHaveLength(64)
    expect(values.has('jwt_secret')).toBe(true)

    // Fetching again should return cached / stored value
    const secret2 = await getJwtSecret(db)
    expect(secret2).toBe(secret1)

    // Rotating secret should change the value in D1 and cache
    const secret3 = await rotateJwtSecret(db)
    expect(secret3).toHaveLength(64)
    expect(secret3).not.toBe(secret1)

    const secret4 = await getJwtSecret(db)
    expect(secret4).toBe(secret3)
  })
})

describe('JWT secret cache across isolates', () => {
  beforeEach(() => {
    resetJwtSecretCache()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    resetJwtSecretCache()
  })

  // 模拟另一 isolate：直接改 D1 中的值，而本 isolate 的内存缓存不知情。
  function rotateElsewhere(values: Map<string, string>, secret: string): void {
    values.set('jwt_secret', JSON.stringify(secret))
  }

  it('re-reads the secret from D1 once the cache TTL expires', async () => {
    const { db, values } = createFakeDb({ jwt_secret: 'a'.repeat(64) })
    expect(await getJwtSecret(db)).toBe('a'.repeat(64))

    rotateElsewhere(values, 'b'.repeat(64))
    vi.advanceTimersByTime(JWT_SECRET_CACHE_TTL_MS - 1)
    expect(await getJwtSecret(db)).toBe('a'.repeat(64))

    vi.advanceTimersByTime(1)
    expect(await getJwtSecret(db)).toBe('b'.repeat(64))
  })

  it('stops accepting tokens signed with a secret rotated in another isolate after the TTL', async () => {
    const { db, values } = createFakeDb({ jwt_secret: 'a'.repeat(64) })
    const oldToken = await signJwt({ username: 'admin', exp: Date.now() + 3_600_000 }, await getJwtSecret(db))

    rotateElsewhere(values, 'b'.repeat(64))
    vi.advanceTimersByTime(JWT_SECRET_CACHE_TTL_MS)
    expect(await verifyJwt(oldToken, await getJwtSecret(db))).toBeNull()
  })

  it('refreshes on verify failure so a token from the new secret is accepted immediately', async () => {
    const { db, values } = createFakeDb({ jwt_secret: 'a'.repeat(64) })
    await getJwtSecret(db)
    rotateElsewhere(values, 'b'.repeat(64))
    const newToken = await signJwt({ username: 'admin', exp: Date.now() + 3_600_000 }, 'b'.repeat(64))

    vi.advanceTimersByTime(JWT_SECRET_REFRESH_MIN_INTERVAL_MS)
    expect(await verifyJwt(newToken, await getJwtSecret(db))).toBeNull()
    const refreshed = await refreshJwtSecretAfterVerifyFailure(db)
    expect(refreshed).toBe('b'.repeat(64))
    expect(await verifyJwt(newToken, refreshed!)).not.toBeNull()
  })

  it('rate-limits refresh-on-failure and returns null when the secret is unchanged', async () => {
    const { db, values } = createFakeDb({ jwt_secret: 'a'.repeat(64) })
    await getJwtSecret(db)
    rotateElsewhere(values, 'b'.repeat(64))

    // 刚加载过：不重读
    expect(await refreshJwtSecretAfterVerifyFailure(db)).toBeNull()
    expect(await getJwtSecret(db)).toBe('a'.repeat(64))

    vi.advanceTimersByTime(JWT_SECRET_REFRESH_MIN_INTERVAL_MS)
    expect(await refreshJwtSecretAfterVerifyFailure(db)).toBe('b'.repeat(64))

    // 密钥未变：重读后返回 null，调用方不重试
    vi.advanceTimersByTime(JWT_SECRET_REFRESH_MIN_INTERVAL_MS)
    expect(await refreshJwtSecretAfterVerifyFailure(db)).toBeNull()
  })
})
