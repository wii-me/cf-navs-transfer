// 本地 wrangler 调用的公共部分：仓库根目录、wrangler 可执行入口、配置选择与一次性子命令。
// smoke-local 与两个图标实验脚本原先各自复制了一份（代码审查三轮第 35 项）。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const wranglerBin = path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

/** 显式覆盖优先；否则有 wrangler.local.toml 用它，没有就用公开的 wrangler.toml。 */
export function resolveWranglerConfig(override) {
  if (override) return override
  const localConfig = path.join(rootDir, 'wrangler.local.toml')
  return existsSync(localConfig) ? localConfig : path.join(rootDir, 'wrangler.toml')
}

/** 同步执行一条 wrangler 子命令（附带 --config），失败时抛出带标签与退出码的错误。 */
export function runWranglerSync(configPath, args, label) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args, '--config', configPath], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`)
}
