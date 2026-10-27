import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 断言对象是 worker/routes/favicon.ts 的内部规则，外加两个 Svelte 文件的跨组件接线（PROB-18）：
// favicon.ts 的 manifest 图标解析要早于 ${fallbackOrigin}/favicon.ico 回退；末组只查 BookmarkEditModal 是否用 requestId 复位、
// BookmarkBaseFields 是否接了 on:blur。断言的是模块里的「登记/接线次序」，挂组件既看不到 Hono 中间件登记顺序，也测不出这种源码级 wiring。

describe('site meta route wiring', () => {
  const routes = readFileSync('worker/routes/favicon.ts', 'utf8')

  // 鉴权与 CORS 的注册已改为「公开子应用 + 统一 authRequired 的受保护子应用」，
  // 由 tests/unit/routeAuth.test.ts 枚举路由做行为断言，不再做源码文本断言。

  it('never fails the site meta request, falling back to the hostname', () => {
    expect(routes).toContain('hostnameFallbackTitle')
    expect(routes).toContain('SITE_META_DEADLINE_MS')
  })

  it('resolves manifest icons between html links and the favicon.ico fallback', () => {
    expect(routes).toContain('extractManifestUrl')
    expect(routes).toContain('fetchManifestJson')
    expect(routes).toContain('extractManifestIcons')
    const manifestAt = routes.indexOf('extractManifestUrl(page.html')
    const originFaviconAt = routes.indexOf('${fallbackOrigin}/favicon.ico')
    expect(manifestAt).toBeGreaterThan(0)
    expect(manifestAt).toBeLessThan(originFaviconAt)
  })

  it('wires the blur trigger and the single-instance requestId reset', () => {
    const baseFields = readFileSync('src/components/BookmarkBaseFields.svelte', 'utf8')
    const modal = readFileSync('src/components/BookmarkEditModal.svelte', 'utf8')

    expect(baseFields).toContain('onblur={() => onUrlBlur?.()}')
    expect(modal).toContain('createBookmarkTitleState(titleLookupState.requestId)')
    expect(modal).toContain('onUrlBlur={handleUrlBlur}')
  })
})
