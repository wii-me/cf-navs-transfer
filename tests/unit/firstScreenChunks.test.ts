import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 接线断言（代码审查二轮第 4 项）：这些模块只在少见路径用到，必须保持动态导入，
// 否则会重新进入首屏 index chunk。实际 chunk 拆分以 `npm run build` 输出为准。
describe('first-screen chunk wiring', () => {
  const app = readFileSync('src/App.svelte', 'utf8')
  const card = readFileSync('src/components/BookmarkCard.svelte', 'utf8')
  const appData = readFileSync('src/lib/appData.ts', 'utf8')
  // 静态导入的模块路径先抽取再比对：不在运行时拼接 RegExp，避免路径元字符漏转义。
  const staticImportSources = [...app.matchAll(/import\s+\w+\s+from\s+'([^']+)'/g)].map((match) => match[1])

  it('loads install and recover views on demand', () => {
    expect(app).not.toMatch(/import\s+(Install|Recover)\s+from/)
    expect(app).toContain("import('./views/Install.svelte')")
    expect(app).toContain("import('./views/Recover.svelte')")
  })

  it('keeps every lazily registered component as a literal dynamic import', () => {
    // 代码审查三轮第 11 项：懒加载注册表只接收函数，路径必须仍以字面量 import() 写在 App 里，
    // 不能改成静态导入或拼接路径，否则 Vite 分包会变化。
    for (const path of [
      './views/Admin.svelte',
      './components/LoginModal.svelte',
      './components/BookmarkEditModal.svelte',
      './components/CategoryEditModal.svelte',
      './components/SearchSpotlight.svelte',
      './views/Install.svelte',
      './views/Recover.svelte',
    ]) {
      expect(app).toContain(`import('${path}')`)
      expect(staticImportSources).not.toContain(path)
    }
  })

  it('keeps the context menu and full theme presets out of the home path', () => {
    expect(card).not.toMatch(/import\s+BookmarkContextMenu\s+from/)
    expect(appData).not.toContain("from './themePresets'")
    expect(appData).toContain("from './themePresetRender'")
  })
})
