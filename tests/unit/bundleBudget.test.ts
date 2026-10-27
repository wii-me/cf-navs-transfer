import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkBudget, collectFirstScreenAssets, measure } from '../../scripts/lib/bundleBudget.mjs'

describe('bundle budget gate', () => {
  it('collects the entry script, modulepreloads and stylesheets from index.html', () => {
    const html = `<html><head>
      <script type="module" crossorigin src="/assets/index-a.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-b.js">
      <link rel="stylesheet" crossorigin href="/assets/index-c.css">
      <link rel="icon" href="/icon.png">
      <link rel="manifest" href="/manifest.webmanifest">
    </head></html>`
    expect(collectFirstScreenAssets(html)).toEqual({ js: ['/assets/index-a.js', '/assets/vendor-b.js'], css: ['/assets/index-c.css'] })
  })

  it('measures raw and gzip bytes across files', () => {
    const size = measure([Buffer.from('a'.repeat(1000)), Buffer.from('b'.repeat(500))])
    expect(size.raw).toBe(1500)
    expect(size.gzip).toBeGreaterThan(0)
    expect(size.gzip).toBeLessThan(size.raw)
  })

  it('reports each metric over budget and passes at the limit', () => {
    const sizes = { js: { raw: 100, gzip: 40 }, css: { raw: 10, gzip: 5 } }
    expect(checkBudget(sizes, { js: { raw: 100, gzip: 40 }, css: { raw: 10, gzip: 5 } })).toEqual([])
    expect(checkBudget(sizes, { js: { raw: 99, gzip: 40 }, css: { raw: 10, gzip: 4 } })).toEqual([
      'js raw 100 B > budget 99 B',
      'css gzip 5 B > budget 4 B',
    ])
  })

  it('ships a budget file with numeric limits wired into CI', () => {
    const budget = JSON.parse(readFileSync('bundle-budget.json', 'utf8'))
    for (const kind of ['js', 'css']) for (const metric of ['raw', 'gzip']) expect(typeof budget[kind][metric]).toBe('number')
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('npm run check:bundle')
  })
})
