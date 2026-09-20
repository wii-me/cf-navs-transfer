import type { Env } from '../types'
import { hashPassword, verifyPassword } from './crypto'
import { getSettingValues, setSettingValue } from './db'

export const ADMIN_USERNAME_KEY = 'admin_username'
export const ADMIN_PASSWORD_KEY = 'admin_password'
const BOOTSTRAP_USERNAME_KEY = 'admin_bootstrap_username'
export const BOOTSTRAP_PASSWORD_KEY = 'admin_bootstrap_password'
export const INSTALL_MARKER_KEY = 'installation_schema_version'
const RESET_MARKER_KEY = 'admin_reset_marker'

export interface AdminCredentials {
  username: string
  passwordHash: string
  resetApplied?: boolean
}

export interface AdminBootstrapOptions {
  applyCredentialReset?: boolean
}

export async function ensureAdminBootstrap(
  env: Env,
  options: AdminBootstrapOptions = {},
): Promise<AdminCredentials> {
  const applyCredentialReset = options.applyCredentialReset ?? true
  const credentials = await getSettingValues<string | number>(env.DB, [
    ADMIN_USERNAME_KEY,
    ADMIN_PASSWORD_KEY,
    BOOTSTRAP_USERNAME_KEY,
    BOOTSTRAP_PASSWORD_KEY,
    INSTALL_MARKER_KEY,
    RESET_MARKER_KEY,
  ])
  const adminUsername = credentials.get(ADMIN_USERNAME_KEY)
  const adminPassword = credentials.get(ADMIN_PASSWORD_KEY)
  const bootstrapUsername = credentials.get(BOOTSTRAP_USERNAME_KEY)
  const bootstrapPassword = credentials.get(BOOTSTRAP_PASSWORD_KEY)
  const installMarker = credentials.get(INSTALL_MARKER_KEY)
  const appliedResetMarker = credentials.get(RESET_MARKER_KEY)
  const hasAdminUsername = typeof adminUsername === 'string' && adminUsername.length > 0
  const hasAdminPassword = typeof adminPassword === 'string' && adminPassword.length > 0
  const hasBootstrapUsername = typeof bootstrapUsername === 'string' && bootstrapUsername.length > 0
  const hasBootstrapPassword = typeof bootstrapPassword === 'string' && bootstrapPassword.length > 0
  const webInstalled = typeof installMarker === 'number' && Number.isInteger(installMarker) && installMarker > 0
  const initUsername = env.INIT_ADMIN_USER?.trim()
  const initPassword = env.INIT_ADMIN_PASSWORD?.trim()
  const resetMarker = env.RESET_ADMIN_CREDENTIALS?.trim()

  const hasInitCredentials = Boolean(initUsername && initPassword)
  const hasBootstrapMarker = hasBootstrapUsername && hasBootstrapPassword
  const resetRequested =
    Boolean(resetMarker) && resetMarker !== appliedResetMarker
  let initCredentialsChanged = false
  if (applyCredentialReset && hasInitCredentials && hasBootstrapMarker && !webInstalled) {
    initCredentialsChanged =
      bootstrapUsername !== initUsername ||
      !(await verifyPassword(initPassword, bootstrapPassword))
  }

  if (
    applyCredentialReset &&
    hasInitCredentials &&
    (resetRequested || initCredentialsChanged)
  ) {
    const nextPasswordHash = await hashPassword(initPassword)
    const writes: Promise<unknown>[] = [
      setSettingValue(env.DB, ADMIN_USERNAME_KEY, initUsername),
      setSettingValue(env.DB, ADMIN_PASSWORD_KEY, nextPasswordHash),
      setSettingValue(env.DB, BOOTSTRAP_USERNAME_KEY, initUsername),
      setSettingValue(env.DB, BOOTSTRAP_PASSWORD_KEY, nextPasswordHash),
    ]

    if (resetMarker) {
      writes.push(setSettingValue(env.DB, RESET_MARKER_KEY, resetMarker))
    }

    await Promise.all(writes)

    return {
      username: initUsername,
      passwordHash: nextPasswordHash,
      resetApplied: true,
    }
  }

  if (hasAdminUsername && hasAdminPassword) {
    // Existing installations created before bootstrap markers were added keep
    // their current credentials on the first request after the upgrade.
    if (!hasBootstrapMarker && hasInitCredentials) {
      const bootstrapPasswordHash = await hashPassword(initPassword)
      await Promise.all([
        setSettingValue(env.DB, BOOTSTRAP_USERNAME_KEY, initUsername),
        setSettingValue(env.DB, BOOTSTRAP_PASSWORD_KEY, bootstrapPasswordHash),
      ])
    }

    return {
      username: adminUsername,
      passwordHash: adminPassword,
    }
  }

  if (!initUsername || !initPassword) {
    throw new Error('Missing INIT_ADMIN_USER or INIT_ADMIN_PASSWORD for admin bootstrap')
  }

  const initPasswordHash = await hashPassword(initPassword)
  const nextPasswordHash = typeof adminPassword === 'string' ? adminPassword : initPasswordHash
  const writes: Promise<unknown>[] = []

  if (!adminUsername) {
    writes.push(setSettingValue(env.DB, ADMIN_USERNAME_KEY, initUsername))
  }

  if (!adminPassword) {
    writes.push(setSettingValue(env.DB, ADMIN_PASSWORD_KEY, initPasswordHash))
  }

  if (!bootstrapUsername || !bootstrapPassword) {
    writes.push(setSettingValue(env.DB, BOOTSTRAP_USERNAME_KEY, initUsername))
    writes.push(setSettingValue(env.DB, BOOTSTRAP_PASSWORD_KEY, initPasswordHash))
  }

  await Promise.all(writes)

  return {
    username: typeof adminUsername === 'string' ? adminUsername : initUsername,
    passwordHash: typeof adminPassword === 'string' ? adminPassword : nextPasswordHash,
  }
}
