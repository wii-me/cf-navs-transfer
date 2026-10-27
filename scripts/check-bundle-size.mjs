#!/usr/bin/env node
// CI 包体积门禁：`npm run build` 之后运行，首屏 JS / CSS 超出 bundle-budget.json 即失败。
// 有意增大首屏时，在同一提交里调高预算并在 CHANGELOG 写明原因。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBudget, measureDist } from './lib/bundleBudget.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const budget = JSON.parse(readFileSync(path.join(rootDir, 'bundle-budget.json'), 'utf8'))
const { assets, sizes } = measureDist(path.join(rootDir, 'dist'))
const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`
console.log(`first-screen JS  (${assets.js.length} file): ${kb(sizes.js.raw)}, gzip ${kb(sizes.js.gzip)}`)
console.log(`first-screen CSS (${assets.css.length} file): ${kb(sizes.css.raw)}, gzip ${kb(sizes.css.gzip)}`)
const failures = checkBudget(sizes, budget)
if (failures.length > 0) {
  for (const failure of failures) console.error(`bundle budget exceeded: ${failure}`)
  process.exit(1)
}
console.log('bundle budget: ok')
