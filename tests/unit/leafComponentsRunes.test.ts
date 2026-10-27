import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 代码审查三轮第 20 项（APP_SPLIT_PLAN 第 8c 步）：14 个层级 0 纯展示组件改为 runes 模式的源码护栏。
// 行为等价由 tests/unit/leafComponentsBehavior.test.ts（迁移前写成、迁移时未改）及 appSplash /
// deviceIconCachePanel / bookmarkIconTimeout 保证。
// 第 21 项（第 8d 步）追加 9 个层级 0 有状态组件，行为等价由 statefulLeafComponentsBehavior /
// cachedBookmarkIconBehavior（迁移前写成、迁移时未改）及各组件原有测试保证。
// 第 22 项（第 8e 步）追加 ui/ 四个组件与 ColorAlphaInput、GradientPresetSelector：事件分发改回调 prop、
// <slot> 改 snippet，行为等价由 uiLeafComponentsBehavior（迁移前写成、迁移时未改，经真实 legacy 父组件观察）保证。
const UI_LEAF = [
  'ColorAlphaInput',
  'settings/GradientPresetSelector',
  'ui/InputGroup',
  'ui/Slider',
  'ui/Switch',
  'ui/Tooltip',
]
const STATEFUL = [
  'BackupPanel',
  'CachedBookmarkIcon',
  'CategoryIcon',
  'CategoryTreeSelect',
  'ConfirmDialog',
  'HomeFloatingActions',
  'LoginModal',
  'PasswordChangePanel',
  'SearchBox',
]

const MIGRATED = [
  'AdminSidebar',
  'AppSplash',
  'BookmarkCustomIconField',
  'BookmarkIcon',
  'BookmarkIconCandidateButton',
  'BookmarkLinkModal',
  'BookmarkModalActions',
  'BookmarkModalHeader',
  'HomeContentSummary',
  'HomeEmptyPanel',
  'LogoSchemeSelector',
  'admin/AdminPageHeader',
  'settings/FooterSettingsSection',
  ...STATEFUL,
  ...UI_LEAF,
]

describe('level-0 presentational and stateful components in runes mode', () => {
  it.each(MIGRATED)('%s opts into runes and drops the legacy syntax', (name) => {
    const source = readFileSync(`src/components/${name}.svelte`, 'utf8')
    const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'))
    const markup = source.slice(source.indexOf('</script>'))

    expect(source.startsWith('<svelte:options runes />')).toBe(true)
    expect(script).not.toMatch(/\bexport let\b/)
    expect(script).not.toMatch(/^\s*\$:/m)
    expect(script).not.toContain('createEventDispatcher')
    expect(source).not.toMatch(/\$\$(props|restProps|slots)/)
    expect(markup).not.toMatch(/\son:[a-z]+[=|]/)
    expect(markup).not.toContain('<slot')
    expect(script).toMatch(/\}: Props = \$props\(\)/)
    expect(script).not.toMatch(/\b(beforeUpdate|afterUpdate)\b/)
  })

  it('keeps the props that legacy parents bind: two-way bindable', () => {
    const read = (path: string) => readFileSync(path, 'utf8')
    expect(read('src/components/CategoryTreeSelect.svelte')).toContain('value = $bindable(undefined)')
    expect(read('src/components/SearchBox.svelte')).toContain("query = $bindable('')")
    expect(read('src/components/BackupPanel.svelte')).toContain("importSource = $bindable('cf-navs')")
    expect(read('src/components/HomeHeroSearch.svelte')).toMatch(/<SearchBox[^>]*\bbind:query\b/)
    expect(read('src/components/admin/AdminTabContent.svelte')).toMatch(/<BackupPanel[^>]*\bbind:importSource\b/)
    expect(read('src/components/BookmarkContextMenu.svelte')).toMatch(/<CategoryTreeSelect[^>]*\bbind:value=\{moveCategoryId\}/)
  })

  it('does not deep-proxy replaced Sets or local-icon snapshots', () => {
    const read = (path: string) => readFileSync(path, 'utf8')
    expect(read('src/components/BackupPanel.svelte')).toContain('let selectedCategoryIds = $state.raw(')
    expect(read('src/components/BackupPanel.svelte')).toContain('let expandedRootIds = $state.raw(')
    expect(read('src/components/CategoryTreeSelect.svelte')).toContain('let expandedRootIds = $state.raw(')
    expect(read('src/components/CachedBookmarkIcon.svelte')).toContain('let localImage = $state.raw(emptyLocalIcon)')
    expect(read('src/components/CategoryIcon.svelte')).toContain('let localState: LocalIconState = $state.raw(emptyLocalIcon)')
  })

  it('keeps the form two-way bindable for SettingsPanel', () => {
    const footer = readFileSync('src/components/settings/FooterSettingsSection.svelte', 'utf8')
    expect(footer).toContain('form = $bindable()')
    expect(readFileSync('src/components/SettingsPanel.svelte', 'utf8')).toContain('<FooterSettingsSection bind:form {saving} />')
  })

  it('replaces dispatched events with callback props and slots with snippets', () => {
    const read = (path: string) => readFileSync(path, 'utf8')
    expect(read('src/components/ui/InputGroup.svelte')).toContain("value = $bindable('')")
    expect(read('src/components/ui/InputGroup.svelte')).toContain('{@render suffix?.()}')
    expect(read('src/components/ui/Slider.svelte')).toContain('value = $bindable(0)')
    expect(read('src/components/ColorAlphaInput.svelte')).toContain("value = $bindable('#ffffff')")
    expect(read('src/components/ColorAlphaInput.svelte')).toContain('alpha = $bindable(null)')
    expect(read('src/components/ui/Switch.svelte')).toContain('{@render children?.()}')
    // Switch 的 checked 没有调用处 bind:，保持普通 prop
    expect(read('src/components/ui/Switch.svelte')).not.toContain('$bindable')
  })

  it('updates every legacy parent call site to the callback props and suffix snippet', () => {
    const parents = [
      'src/components/BookmarkEditModal.svelte',
      'src/components/GradientBackgroundInput.svelte',
      'src/components/settings/AdvancedSettingsSection.svelte',
      'src/components/settings/BackgroundSettingsSection.svelte',
      'src/components/settings/BasicSettingsSection.svelte',
      'src/components/settings/CardSettingsSection.svelte',
      'src/components/settings/CategoryDisplaySettingsSection.svelte',
      'src/components/settings/HeroSettingsSection.svelte',
      'src/components/settings/NavigationSettingsSection.svelte',
      'src/components/settings/SearchEngineSettingsSection.svelte',
      'src/components/settings/ThemeBackgroundCard.svelte',
    ]
    // 开始标签：属性表达式里可能有 `=>` 与两层花括号
    const tag = /<(InputGroup|Slider|Switch|ColorAlphaInput|GradientPresetSelector)\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*>/g
    let tags = 0
    for (const path of parents) {
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(tag)) {
        tags += 1
        expect(match[0], `${path}: ${match[1]}`).not.toMatch(/\son:[a-z]+=/)
        expect(match[0], `${path}: ${match[1]}`).not.toContain('event.detail')
      }
      // legacy 父组件的 slot="suffix" 不会传到 runes 子组件的 suffix snippet，必须写成 {#snippet suffix()}
      expect(source, path).not.toMatch(/slot="suffix"/)
    }
    expect(tags).toBe(39)
  })
})
