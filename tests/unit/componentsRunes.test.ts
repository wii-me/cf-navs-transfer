import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 代码审查三轮第 23 项起（APP_SPLIT_PLAN 第 8f 步起）：层级 0 视图与层级 1+ 组件改为 runes 模式的源码护栏。
// 8c–8e 的 29 个叶子见 tests/unit/leafComponentsRunes.test.ts。行为等价由各批迁移前写成、迁移时未改的行为基线保证：
// 8f viewsBehavior；8g level1ComponentsBehavior；8h adminSectionsBehavior。

const read = (path: string) => readFileSync(path, 'utf8')

function expectRunes(path: string): void {
  const source = read(path)
  // 实例脚本（Admin 另有 `<script module>`，只放类型导出）
  const start = source.search(/<script(?! module)[^>]*>/)
  const script = source.slice(start, source.indexOf('</script>', start))
  const markup = source.slice(source.indexOf('</script>', start))

  expect(source.startsWith('<svelte:options runes />')).toBe(true)
  expect(script).not.toMatch(/\bexport let\b/)
  expect(script).not.toMatch(/^\s*\$:/m)
  expect(script).not.toContain('createEventDispatcher')
  expect(source).not.toMatch(/\$\$(props|restProps|slots)/)
  expect(markup).not.toMatch(/\son:[a-z]+[=|]/)
  expect(markup).not.toContain('<slot')
  expect(markup).not.toMatch(/\sslot="/)
  expect(markup).not.toContain('<svelte:component')
  // Toast 没有 props
  if (!path.endsWith('/Toast.svelte')) expect(script).toMatch(/\}: Props = \$props\(\)/)
  expect(script).not.toMatch(/\b(beforeUpdate|afterUpdate)\b/)
}

const VIEWS_8F = ['src/views/Install.svelte', 'src/views/Recover.svelte']

describe('8f: lazy-loaded views in runes mode', () => {
  it.each(VIEWS_8F)('%s opts into runes and drops the legacy syntax', expectRunes)

  it('moves the submit preventDefault modifier into the handler', () => {
    for (const path of VIEWS_8F) {
      const source = read(path)
      expect(source, path).toContain('onsubmit={handleSubmit}')
      expect(source, path).toMatch(/async function handleSubmit\(event: SubmitEvent\): Promise<void> \{\n\s+event\.preventDefault\(\)/)
    }
  })

  it('keeps the form fields and error flags reactive', () => {
    expect(read('src/views/Install.svelte')).toContain("let username = $state('admin')")
    expect(read('src/views/Recover.svelte')).toContain('let submitting = $state(false)')
    expect(read('src/views/Recover.svelte')).toContain('let tokenHint = $state(false)')
  })
})

const LEVEL1_8G = [
  'BookmarkBaseFields',
  'BookmarkCardCompact',
  'BookmarkCardInfo',
  'BookmarkContextMenu',
  'BookmarkIconCandidatePicker',
  'GradientBackgroundInput',
  'HomeCategoryScope',
  'HomeHeroSearch',
  'IconifySelector',
  'Sidebar',
  'SpotlightBookmarkIcon',
].map((name) => `src/components/${name}.svelte`)

describe('8g: level-1 home and bookmark components in runes mode', () => {
  it.each(LEVEL1_8G)('%s opts into runes and drops the legacy syntax', expectRunes)

  it('keeps every prop that a parent binds two-way bindable, and the parents still bind them', () => {
    const base = read('src/components/BookmarkBaseFields.svelte')
    for (const name of ['categoryId', 'title', 'url', 'openMethod', 'isPrivate', 'description', 'descriptionMode']) {
      expect(base, name).toMatch(new RegExp(`\\b${name} = \\$bindable\\(`))
      expect(read('src/components/BookmarkEditModal.svelte'), name).toContain(`bind:${name}={form.`)
    }
    expect(read('src/components/HomeHeroSearch.svelte')).toContain("query = $bindable('')")
    expect(read('src/views/Home.svelte')).toContain('bind:query={searchQuery}')
    expect(read('src/components/settings/SettingsHomePreview.svelte')).toContain('bind:query={previewQuery}')
    expect(read('src/components/IconifySelector.svelte')).toContain("iconifyName = $bindable('')")
    expect(read('src/components/BookmarkEditModal.svelte')).toMatch(/<IconifySelector\s+bind:iconifyName/)
    expect(read('src/components/CategoryEditModal.svelte')).toMatch(/<IconifySelector\s+bind:iconifyName/)
    expect(read('src/components/GradientBackgroundInput.svelte')).toContain("value = $bindable('')")
    // 只被单向传入的 prop 不做 bindable
    for (const path of ['BookmarkCardCompact', 'BookmarkCardInfo', 'BookmarkContextMenu', 'HomeCategoryScope', 'Sidebar', 'SpotlightBookmarkIcon']) {
      expect(read(`src/components/${path}.svelte`), path).not.toContain('$bindable')
    }
  })

  it('replaces the GradientBackgroundInput change event with an onchange callback at its only call site', () => {
    expect(read('src/components/GradientBackgroundInput.svelte')).toContain('onchange?.(value)')
    const card = read('src/components/settings/ThemeBackgroundCard.svelte')
    const tag = card.slice(card.indexOf('<GradientBackgroundInput'), card.indexOf('/>', card.indexOf('<GradientBackgroundInput')))
    expect(tag).toContain('onchange={() => void syncBackground()}')
    expect(tag).not.toMatch(/\son:change/)
  })

  it('keeps the context menu stopPropagation listeners directly on the menu node and remeasures after updates', () => {
    const menu = read('src/components/BookmarkContextMenu.svelte')
    expect(menu).toContain('{@attach attachMenuListeners}')
    expect(menu).toContain("import { on } from 'svelte/events'")
    expect(menu).toMatch(/\$effect\(\(\) => \{\n\s+void \[placement, maxHeight, topOffset, onEdit, movePickerOpen, canMove, onMoveBookmark, categories, categories\.length, moveCategoryId\]\n\s+untrack\(scheduleMeasure\)/)
    expect(menu).toMatch(/<CategoryTreeSelect[^>]*\bbind:value=\{moveCategoryId\}/)
  })

  it('does not deep-proxy replaced Sets, observers or local-icon snapshots', () => {
    const sidebar = read('src/components/Sidebar.svelte')
    expect(sidebar).toContain('let expandedParentIds = $state.raw(new Set<string>())')
    expect(sidebar).toContain('let resizeObserver: ResizeObserver | null = $state.raw(null)')
    expect(read('src/components/SpotlightBookmarkIcon.svelte')).toContain('let localImage = $state.raw(emptyLocalIcon)')
  })
})

const ADMIN_SECTIONS_8H = [
  'admin/AnalyticsPanel',
  'admin/BookmarkListPanel',
  'admin/CategoryListPanel',
  'settings/BackgroundSettingsSection',
  'settings/BasicSettingsSection',
  'settings/CardSettingsSection',
  'settings/CategoryDisplaySettingsSection',
  'settings/HeroSettingsSection',
  'settings/NavigationSettingsSection',
  'settings/SearchEngineSettingsSection',
].map((name) => `src/components/${name}.svelte`)

describe('8h: admin panels and settings sections in runes mode', () => {
  it.each(ADMIN_SECTIONS_8H)('%s opts into runes and drops the legacy syntax', expectRunes)

  it('keeps the settings form two-way bindable for SettingsPanel', () => {
    // 父组件：SettingsPanel；CategoryDisplay 嵌在 AdvancedSettingsSection 里
    const parents = read('src/components/SettingsPanel.svelte') + read('src/components/settings/AdvancedSettingsSection.svelte')
    for (const path of ADMIN_SECTIONS_8H.filter((item) => item.includes('/settings/'))) {
      expect(read(path), path).toContain('form = $bindable()')
      const name = path.split('/').pop()!.replace('.svelte', '')
      expect(parents, name).toMatch(new RegExp(`<${name}\\s+bind:form\\b`))
    }
    for (const path of ADMIN_SECTIONS_8H.filter((item) => item.includes('/admin/'))) {
      expect(read(path), path).not.toContain('$bindable')
    }
  })

  it('writes self-referencing statements back only when the value changes', () => {
    expect(read('src/components/settings/CardSettingsSection.svelte')).toContain('if (form.card_show_description !== showDescription) form.card_show_description = showDescription')
    for (const path of ['src/components/admin/BookmarkListPanel.svelte', 'src/components/admin/CategoryListPanel.svelte']) {
      const source = read(path)
      expect(source, path).toContain('if (next !== page) page = next')
      expect(source, path).toContain('if (next.size !== selectedIds.size) selectedIds = next')
    }
    expect(read('src/components/admin/AnalyticsPanel.svelte')).toContain('if (next !== zeroVisitPage) zeroVisitPage = next')
  })

  it('replaces whole collections instead of self-assigning them', () => {
    const bookmarks = read('src/components/admin/BookmarkListPanel.svelte')
    expect(bookmarks).toContain('let selectedIds = $state.raw(new Set<number>())')
    expect(bookmarks).toContain('let healthResults = $state.raw(new Map<')
    expect(bookmarks).not.toMatch(/^\s+healthResults = healthResults$/m)
    expect(bookmarks).toContain('healthResults = next')
    const categories = read('src/components/admin/CategoryListPanel.svelte')
    expect(categories).toContain('let expandedRootIds = $state.raw(new Set<string>())')
    expect(categories).toContain('let collapsedSearchRootIds = $state.raw(new Set<string>())')
  })
})

const LEVEL2_8I = [
  'BookmarkCard',
  'BookmarkEditModal',
  'CategoryEditModal',
  'SearchSpotlight',
  'admin/AdminTabContent',
  'settings/ThemeBackgroundCard',
  'Toast',
].map((name) => `src/components/${name}.svelte`)

describe('8i: level-2 components and Toast in runes mode', () => {
  it.each(LEVEL2_8I)('%s opts into runes and drops the legacy syntax', expectRunes)

  it('replaces the ThemeBackgroundCard change / upload events with callbacks at its only call site', () => {
    const card = read('src/components/settings/ThemeBackgroundCard.svelte')
    expect(card).toContain('onchange?.({ ...background })')
    expect(card).toContain('onclick={() => onupload?.()}')
    const advanced = read('src/components/settings/AdvancedSettingsSection.svelte')
    const tag = advanced.slice(advanced.indexOf('<ThemeBackgroundCard'), advanced.indexOf('/>', advanced.indexOf('<ThemeBackgroundCard')))
    expect(tag).toContain('onchange={(background) => updateThemeBackground(activeTheme, background)}')
    expect(tag).toContain('onupload={openUpload}')
    expect(tag).not.toMatch(/\son:(change|upload)/)
  })

  it('keeps bound fields deeply reactive and only AdminTabContent.importSource bindable', () => {
    expect(read('src/components/BookmarkEditModal.svelte')).toContain('let form: BookmarkFormValue = $state({ ...emptyBookmarkForm })')
    expect(read('src/components/CategoryEditModal.svelte')).toContain('let form: CategoryFormValue = $state({ ...emptyForm })')
    expect(read('src/components/settings/ThemeBackgroundCard.svelte')).toContain('let background: BackgroundSetting = $state(untrack(() => backgroundProp))')
    expect(read('src/components/admin/AdminTabContent.svelte')).toContain("importSource = $bindable('cf-navs')")
    expect(read('src/views/Admin.svelte')).toContain('bind:importSource')
    for (const path of LEVEL2_8I.filter((item) => !item.includes('AdminTabContent'))) {
      expect(read(path), path).not.toContain('$bindable')
    }
  })

  it('keeps the move-trigger stopPropagation listeners directly on the button', () => {
    const card = read('src/components/BookmarkCard.svelte')
    expect(card).toContain('{@attach attachMoveTriggerListeners}')
    expect(card).toContain("import { on } from 'svelte/events'")
    expect(card).toContain('<ContextMenuComponent')
  })

  it('keeps the legacy whole-form dependency of the candidate refresh', () => {
    expect(read('src/components/BookmarkEditModal.svelte')).toContain('for (const key in form) void form[key as keyof BookmarkFormValue]')
  })
})

const TOP_LEVEL_8J = [
  'src/components/CategorySection.svelte',
  'src/components/settings/AdvancedSettingsSection.svelte',
  'src/components/settings/SettingsHomePreview.svelte',
  'src/views/Admin.svelte',
  'src/components/SettingsPanel.svelte',
  'src/views/Home.svelte',
]

describe('8j: top-level components in runes mode', () => {
  it.each(TOP_LEVEL_8J)('%s opts into runes and drops the legacy syntax', expectRunes)

  it('keeps the settings form a deep $state so section field bindings are reactive', () => {
    const panel = read('src/components/SettingsPanel.svelte')
    expect(panel).toContain('let form: SettingsPanelValue = $state(cloneSettingsForm(emptySettingsForm))')
    expect(panel).toContain('let initialForm: SettingsPanelValue = $state.raw(cloneSettingsForm(emptySettingsForm))')
    expect(panel).toContain('<SettingsHomePreview settings={normalizedForm} bind:theme={previewTheme} />')
    expect(read('src/components/settings/AdvancedSettingsSection.svelte')).toContain('let { form = $bindable(), saving = false }: Props = $props()')
    expect(read('src/components/settings/SettingsHomePreview.svelte')).toContain("theme = $bindable('light')")
  })

  it('binds only what parents bind two-way', () => {
    expect(read('src/views/Admin.svelte')).toContain("let importSource: ImportSource = $state('cf-navs')")
    expect(read('src/views/Home.svelte')).toContain('bind:query={searchQuery}')
    for (const path of ['src/components/CategorySection.svelte', 'src/views/Admin.svelte', 'src/views/Home.svelte', 'src/components/SettingsPanel.svelte']) {
      expect(read(path), path).not.toContain('$bindable')
    }
  })

  it('writes the resolved home section id back only when it changes', () => {
    const home = read('src/views/Home.svelte')
    expect(home).toContain('const next = resolveHomeActiveSectionId(navigationSections, activeId)')
    expect(home).toContain('if (next !== activeId) untrack(() => { activeId = next })')
    expect(home).toContain('let selectedCategoryIds = $state.raw(new Map<number, number>())')
    expect(home).toContain('let homeSortDraft: PublicBookmark[] = $state.raw([])')
  })

  it('uses a module script and dynamic components instead of svelte:component', () => {
    const admin = read('src/views/Admin.svelte')
    expect(admin).toContain('<script module lang="ts">')
    expect(admin).toContain('<CategoryEditModalComponent')
  })
})

describe('step 8 complete: every component under src/ is in runes mode', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`
      return entry.isDirectory() ? files(path) : path.endsWith('.svelte') ? [path] : []
    })

  it('has no legacy component and no `export let` left', () => {
    const all = files('src')
    expect(all.length).toBeGreaterThan(60)
    for (const path of all) {
      const source = read(path)
      expect(source.startsWith('<svelte:options runes />'), path).toBe(true)
      expect(source, path).not.toMatch(/\bexport let\b/)
    }
  })
})
