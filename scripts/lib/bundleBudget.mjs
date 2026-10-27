// 首屏包体积预算：读 dist/index.html 引用的入口 JS / CSS 与 modulepreload 依赖，
// 按原始字节与 gzip 字节分别比对 bundle-budget.json。纯函数部分供单测直接调用。
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

/** 从构建出的 index.html 里取首屏资源（入口脚本、modulepreload、样式表）的路径。 */
export function collectFirstScreenAssets(html) {
  const js = new Set()
  const css = new Set()
  for (const match of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) js.add(match[1])
  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0]
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1]
    if (!href) continue
    if (/\brel="modulepreload"/.test(tag)) js.add(href)
    else if (/\brel="stylesheet"/.test(tag)) css.add(href)
  }
  return { js: [...js], css: [...css] }
}

export function measure(buffers) {
  let raw = 0
  let gzip = 0
  for (const buffer of buffers) {
    raw += buffer.length
    gzip += gzipSync(buffer, { level: 9 }).length
  }
  return { raw, gzip }
}

/** 返回超出预算的条目说明；空数组表示全部在预算内。预算单位为字节。 */
export function checkBudget(sizes, budget) {
  const failures = []
  for (const kind of ['js', 'css']) {
    const limit = budget[kind]
    if (!limit) continue
    for (const metric of ['raw', 'gzip']) {
      if (typeof limit[metric] === 'number' && sizes[kind][metric] > limit[metric]) {
        failures.push(`${kind} ${metric} ${sizes[kind][metric]} B > budget ${limit[metric]} B`)
      }
    }
  }
  return failures
}

export function measureDist(distDir) {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8')
  const assets = collectFirstScreenAssets(html)
  if (assets.js.length === 0) throw new Error('dist/index.html has no module entry script')
  const read = (href) => readFileSync(path.join(distDir, href.replace(/^\//, '')))
  return { assets, sizes: { js: measure(assets.js.map(read)), css: measure(assets.css.map(read)) } }
}
