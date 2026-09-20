import { secretsEqual } from './crypto'
import type { Env } from '../types'

// 校验部署者提供的一次性令牌。令牌不落库，实时读 env.SETUP_TOKEN 做常量时间比较。
// 未配置 SETUP_TOKEN 时恒为假，调用方据此统一按未授权处理，不暴露「是否已配置」。
export async function authorizeSetup(env: Env, suppliedToken: string | undefined): Promise<boolean> {
  const configuredToken = env.SETUP_TOKEN?.trim()
  if (!configuredToken || !suppliedToken) return false
  return secretsEqual(suppliedToken, configuredToken)
}

// 同源请求判定：优先信任 Sec-Fetch-Site，其次比对 Origin 与请求 origin。
// 缺少 Origin 头（同源导航常见）视为同源。
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const suppliedOrigin = request.headers.get('Origin')
  if (!suppliedOrigin) return true

  try {
    return new URL(suppliedOrigin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}
