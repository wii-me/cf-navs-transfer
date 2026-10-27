// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import AdvancedSettingsSection from '../../src/components/settings/AdvancedSettingsSection.svelte'
import BackgroundSettingsSection from '../../src/components/settings/BackgroundSettingsSection.svelte'
import BasicSettingsSection from '../../src/components/settings/BasicSettingsSection.svelte'
import CardSettingsSection from '../../src/components/settings/CardSettingsSection.svelte'
import CategoryDisplaySettingsSection from '../../src/components/settings/CategoryDisplaySettingsSection.svelte'
import HeroSettingsSection from '../../src/components/settings/HeroSettingsSection.svelte'
import NavigationSettingsSection from '../../src/components/settings/NavigationSettingsSection.svelte'
import SearchEngineSettingsSection from '../../src/components/settings/SearchEngineSettingsSection.svelte'
import ThemeBackgroundCard from '../../src/components/settings/ThemeBackgroundCard.svelte'
import GradientBackgroundInput from '../../src/components/GradientBackgroundInput.svelte'
import Tooltip from '../../src/components/ui/Tooltip.svelte'
import SectionFormHarness from '../helpers/uiLeaf/SectionFormHarness.svelte'
import SwitchSlotHarness from '../helpers/uiLeaf/SwitchSlotHarness.svelte'
import { createSettingsFormState, type SettingsFormModel } from '../../src/lib/settingsForm'
import { gradientPresets } from '../../src/lib/themePresets'
import type { BackgroundSetting } from '../../shared/types'

// 代码审查三轮第 22 项（APP_SPLIT_PLAN 第 8e 步）：迁移前写成的行为基线。
// 6 个组件（ui/InputGroup、ui/Slider、ui/Switch、ui/Tooltip、ColorAlphaInput、
// settings/GradientPresetSelector）都经由真实父组件（仍为 legacy）观察：子组件派发的
// 值是否被父组件按原语义收到（e.detail → 回调参数）、`bind:` 写回是否在回调前完成、
// 插槽内容是否渲染在原位置。迁移把 createEventDispatcher 换成回调 prop、<slot> 换成
// snippet 时，本文件不应改动。

afterEach(cleanup)

function renderSection(section: any, overrides: Partial<SettingsFormModel> = {}) {
  const form = createSettingsFormState(overrides)
  const seen: SettingsFormModel[] = []
  const view = render(SectionFormHarness, {
    props: { section, form, onForm: (next: SettingsFormModel) => seen.push(next) },
  })
  const latest = () => seen[seen.length - 1]
  return { form, seen, latest, ...view }
}

async function flush(): Promise<void> {
  await tick()
  await tick()
}

describe('Switch：父组件收到切换后的布尔值（原 e.detail）', () => {
  it('BasicSettingsSection 的公开模式与书签同步', async () => {
    const { latest, seen } = renderSection(BasicSettingsSection, { public_mode: true, browser_sync_enabled: false })
    const before = seen.length

    await fireEvent.click(screen.getByRole('switch', { name: '公开模式' }))
    await flush()
    expect(seen.length).toBeGreaterThan(before)
    expect(latest().public_mode).toBe(false)
    expect(screen.getByRole('switch', { name: '公开模式' }).getAttribute('aria-checked')).toBe('false')

    await fireEvent.keyDown(screen.getByRole('switch', { name: '浏览器书签同步' }), { key: 'Enter' })
    await flush()
    expect(latest().browser_sync_enabled).toBe(true)
    expect(latest().public_mode).toBe(false)
  })

  it('HeroSettingsSection：关闭搜索框后引擎选择器开关被禁用', async () => {
    const { latest } = renderSection(HeroSettingsSection, { search_box_show: true, search_engine_selector_show: true })
    const selector = screen.getByRole('switch', { name: '显示引擎选择器' }) as HTMLButtonElement
    expect(selector.disabled).toBe(false)

    await fireEvent.click(screen.getByRole('switch', { name: '显示搜索框' }))
    await flush()

    expect(latest().search_box_show).toBe(false)
    expect((screen.getByRole('switch', { name: '显示引擎选择器' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('switch', { name: '显示站点标题' }))
    await flush()
    expect(latest().site_title_show).toBe(false)
  })

  it('NavigationSettingsSection：布尔值被映射成 wrap/scroll', async () => {
    const { latest } = renderSection(NavigationSettingsSection, {
      navigation: { position: 'top', always_expanded: false, top_layout: 'scroll' },
    })

    await fireEvent.click(screen.getByRole('switch', { name: '顶部分类分行显示' }))
    await flush()
    expect(latest().navigation.top_layout).toBe('wrap')

    await fireEvent.click(screen.getByRole('switch', { name: '顶部分类分行显示' }))
    await flush()
    expect(latest().navigation.top_layout).toBe('scroll')
    // 非左侧模式下「始终展开」禁用，点了也不改值
    const expand = screen.getByRole('switch', { name: '左侧导航始终展开' }) as HTMLButtonElement
    expect(expand.disabled).toBe(true)
  })

  it('CardSettingsSection：极简卡片标题开关', async () => {
    const { latest } = renderSection(CardSettingsSection, { card_style: 'icon', card_icon_show_title: true })

    await fireEvent.click(screen.getByRole('switch', { name: '显示极简卡片标题' }))
    await flush()
    expect(latest().card_icon_show_title).toBe(false)
  })

  it('legacy 父组件传入的默认插槽内容渲染在开关按钮内部、标签之后', () => {
    render(SwitchSlotHarness, { props: { checked: true } })
    const button = screen.getByRole('switch', { name: '带附加内容的开关' })
    const extra = button.querySelector('.switch-extra')

    expect(extra?.textContent).toBe('附加说明')
    expect(button.lastElementChild).toBe(extra)
    expect(button.getAttribute('aria-checked')).toBe('true')
  })
})

describe('InputGroup：bind:value 写回先于回调，number 类型保持数字/空串', () => {
  it('AdvancedSettingsSection 的卡片宽度：数字写回并触发同步', async () => {
    const { form, latest, seen } = renderSection(AdvancedSettingsSection, { card_style: 'info' })
    const before = seen.length
    const input = screen.getByLabelText('详情卡片列宽下限') as HTMLInputElement
    expect(input.disabled).toBe(false)

    await fireEvent.input(input, { target: { value: '210' } })
    await flush()

    expect(form.card_size.width).toBe(210)
    expect(seen.length).toBeGreaterThan(before)
    expect(latest().card_size.width).toBe(210)

    await fireEvent.input(screen.getByLabelText('详情卡片列宽下限'), { target: { value: '' } })
    await flush()
    expect(latest().card_size.width).toBe('')
  })

  it('AdvancedSettingsSection：卡片风格不匹配时输入组禁用', () => {
    renderSection(AdvancedSettingsSection, { card_style: 'icon' })
    expect((screen.getByLabelText('详情卡片列宽下限') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('极简卡片图标大小') as HTMLInputElement).disabled).toBe(false)
  })

  it('NavigationSettingsSection：具名插槽里的单位下拉渲染在后缀容器内并能提交', async () => {
    const { latest } = renderSection(NavigationSettingsSection)
    const input = screen.getByRole('spinbutton', { name: '最大宽度' }) as HTMLInputElement
    const unit = screen.getByLabelText('最大宽度单位') as unknown as HTMLSelectElement

    expect(unit.closest('.ui-input-group-suffix')).toBeTruthy()
    expect(unit.closest('.ui-input-group')).toBe(input.closest('.ui-input-group'))

    await fireEvent.input(input, { target: { value: '80' } })
    await flush()
    expect(latest().content_layout.max_width).toBe(80)

    unit.value = '%'
    await fireEvent.change(unit)
    await flush()
    expect(latest().content_layout.max_width_unit).toBe('%')
    expect(latest().content_layout.max_width).toBe(80)
  })

  it('SearchEngineSettingsSection：url 输入保持字符串，后缀按钮按模板生成图标', async () => {
    const { latest } = renderSection(SearchEngineSettingsSection, {
      search_engine: {
        current: 'Google',
        engines: [{ name: 'Google', icon: '', url_template: 'https://www.google.com/search?q={q}' }],
      },
    })
    const input = screen.getByLabelText('图标链接') as HTMLInputElement

    await fireEvent.input(input, { target: { value: 'https://a.example/icon.png' } })
    await flush()
    expect(latest().search_engine.engines[0].icon).toBe('https://a.example/icon.png')

    const button = screen.getByRole('button', { name: '根据查询模板域名生成图标' })
    expect(button.closest('.ui-input-group-suffix')).toBeTruthy()
    await fireEvent.click(button)
    await flush()
    expect(latest().search_engine.engines[0].icon).toContain('google.com')
    expect((screen.getByLabelText('图标链接') as HTMLInputElement).value).toContain('google.com')
  })

  // 第 8i 步 ThemeBackgroundCard 自身改为 runes：`change` / `upload` 事件随之改为 `onchange` / `onupload` 回调 prop（参数即原 e.detail）。
  it('ThemeBackgroundCard：svelte:fragment 具名插槽按 uploadHost 显示上传按钮', async () => {
    const background: BackgroundSetting = { type: 'image', value: '', blur: 0, mask: 0.2, maskColor: '#000000' }
    const onChange = vi.fn()
    const onUpload = vi.fn()
    const view = render(ThemeBackgroundCard, {
      props: { theme: 'light', background, uploadHost: 'https://img.example', onchange: onChange, onupload: onUpload },
    })

    const upload = screen.getByRole('button', { name: '打开图床上传 ↗' })
    expect(upload.closest('.ui-input-group-suffix')).toBeTruthy()
    await fireEvent.click(upload)
    expect(onUpload).toHaveBeenCalledTimes(1)

    await fireEvent.input(screen.getByLabelText('浅色背景图片地址'), { target: { value: 'https://img.example/a.jpg' } })
    await flush()
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'image', value: 'https://img.example/a.jpg' }))

    await view.rerender({ theme: 'light', background, uploadHost: '' })
    expect(screen.queryByRole('button', { name: '打开图床上传 ↗' })).toBeNull()
    expect(document.querySelector('.ui-input-group-suffix')?.children.length).toBe(0)
  })
})

describe('Slider：bind:value 写回数字并触发父组件同步', () => {
  it('BasicSettingsSection 的标题字号', async () => {
    const { form, latest } = renderSection(BasicSettingsSection, { site_title_font_size: 32 })
    const slider = screen.getByRole('slider', { name: '首页标题字号' })

    await fireEvent.input(slider, { target: { value: '40' } })
    await flush()

    expect(form.site_title_font_size).toBe(40)
    expect(latest().site_title_font_size).toBe(40)
    expect(screen.getByRole('slider', { name: '首页标题字号' }).getAttribute('aria-valuetext')).toBe('40 px')
  })

  it('CategoryDisplaySettingsSection：无回调时由 fieldset 的原生 input 冒泡同步', async () => {
    const { latest, seen } = renderSection(CategoryDisplaySettingsSection)
    const before = seen.length

    await fireEvent.input(screen.getByRole('slider', { name: '一级分类标题字号' }), { target: { value: '20' } })
    await flush()

    expect(seen.length).toBeGreaterThan(before)
    expect(latest().category_display.root_font_size).toBe(20)
  })

  it('ThemeBackgroundCard 的模糊度：父组件派发的新背景带上了刚写回的数字', async () => {
    const background: BackgroundSetting = { type: 'color', value: '#ffffff', blur: 0, mask: 0.2, maskColor: '#000000' }
    const onChange = vi.fn()
    render(ThemeBackgroundCard, {
      props: { theme: 'dark', background, onchange: onChange },
    })

    await fireEvent.input(screen.getByRole('slider', { name: '模糊度' }), { target: { value: '12' } })
    await flush()

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ blur: 12 }))
  })
})

describe('ColorAlphaInput：change 载荷与 bind:value / bind:alpha 写回', () => {
  // 第 8g 步 GradientBackgroundInput 自身改为 runes：`change` 事件随之改为 `onchange` 回调 prop（参数即原 e.detail）。
  it('GradientBackgroundInput 用 ColorAlphaInput 的回调值重组渐变并向上回调', async () => {
    const onChange = vi.fn()
    render(GradientBackgroundInput, {
      props: { value: 'linear-gradient(135deg, #111111, #222222)', startLabel: '起始颜色', endLabel: '结束颜色', onchange: onChange },
    })

    await fireEvent.input(screen.getByLabelText('起始颜色'), { target: { value: '#123456' } })
    expect(onChange).toHaveBeenLastCalledWith('linear-gradient(135deg, #123456, #222222)')

    await fireEvent.input(screen.getByLabelText('结束颜色'), { target: { value: 'rgba(1, 2, 3, 0.5)' } })
    expect(onChange).toHaveBeenLastCalledWith('linear-gradient(135deg, #123456, rgba(1, 2, 3, 0.5))')
  })

  it('AdvancedSettingsSection 的卡片表面颜色：带透明度的输入拆成 hex + alpha 写回', async () => {
    const { form, latest } = renderSection(AdvancedSettingsSection, {
      card_background_color: '#ffffff',
      card_background_opacity: 0.9,
    })

    const input = screen.getByLabelText('卡片表面颜色值') as HTMLInputElement
    await fireEvent.input(input, { target: { value: '#11223380' } })
    await flush()

    expect(form.card_background_color).toBe('#112233')
    expect(form.card_background_opacity).toBeCloseTo(0.5, 2)
    expect(latest().card_background_color).toBe('#112233')
    expect(latest().card_background_opacity).toBeCloseTo(0.5, 2)
    expect((screen.getByLabelText('卡片表面颜色值') as HTMLInputElement).value).toBe('#112233')
    // 同一 alpha 绑定的 Slider 跟着变
    expect(screen.getByRole('slider', { name: '卡片不透明度' }).getAttribute('aria-valuetext')).toBe('50%')
  })

  it('AdvancedSettingsSection：父组件改 alpha（Slider）后颜色选择器的透明度跟随', async () => {
    renderSection(AdvancedSettingsSection, { card_background_color: '#336699', card_background_opacity: 0.9 })

    await fireEvent.input(screen.getByRole('slider', { name: '卡片不透明度' }), { target: { value: '0.3' } })
    await flush()
    await fireEvent.click(screen.getByRole('button', { name: '选择卡片表面颜色' }))

    expect(screen.getByRole('slider', { name: '卡片表面透明度' }).getAttribute('aria-valuenow')).toBe('0.3')
  })

  it('ThemeBackgroundCard 的遮罩颜色：键盘调整透明度同时写回 mask 并派发', async () => {
    const background: BackgroundSetting = { type: 'color', value: '#ffffff', blur: 0, mask: 0.5, maskColor: '#000000' }
    const onChange = vi.fn()
    render(ThemeBackgroundCard, {
      props: { theme: 'light', background, onchange: onChange },
    })

    await fireEvent.click(screen.getByRole('button', { name: '选择浅色模式背景遮罩颜色' }))
    await fireEvent.keyDown(screen.getByRole('slider', { name: '浅色模式背景遮罩透明度' }), { key: 'ArrowRight', shiftKey: true })
    await flush()

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mask: 0.6, maskColor: '#000000' }))
    expect(screen.getByRole('slider', { name: '遮罩透明度' }).getAttribute('aria-valuetext')).toBe('60%')
  })
})

describe('GradientPresetSelector：select 载荷是预设对象，custom 无载荷', () => {
  it('BackgroundSettingsSection 选预设后整套写回，选自定义后回到 custom', async () => {
    const { latest } = renderSection(BackgroundSettingsSection, { background_preset_id: 'custom' })
    const preset = gradientPresets[0]

    const option = screen.getByRole('radio', { name: `${preset.label}：${preset.description}` })
    await fireEvent.click(option)
    await flush()

    expect(latest().background_preset_id).toBe(preset.id)
    expect(latest().backgrounds.light).toEqual(preset.light)
    expect(latest().backgrounds.dark).toEqual(preset.dark)
    expect(latest().card_background_color).toBe(preset.cardBackgroundColor)
    expect(screen.getByText('已选方案')).toBeTruthy()
    expect((option as HTMLInputElement).checked).toBe(true)

    const custom = document.querySelector('.gradient-preset-option.custom input') as HTMLInputElement
    await fireEvent.click(custom)
    await flush()

    expect(latest().background_preset_id).toBe('custom')
    expect(latest().backgrounds.light).toEqual(preset.light)
    expect(screen.getAllByText('自定义').length).toBe(2)
  })

  it('展开切换只影响本地状态', async () => {
    renderSection(BackgroundSettingsSection)
    const toggle = screen.getByTestId('gradient-preset-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelectorAll('.gradient-preset-group.collapsed').length).toBe(2)

    await fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('收起其他方案')
    expect(document.querySelectorAll('.gradient-preset-group.collapsed').length).toBe(0)
  })
})

describe('Tooltip：文案 prop 的更新与销毁', () => {
  it('展开中更新 text 立即反映到气泡', async () => {
    const view = render(Tooltip, { props: { text: '旧说明', label: '说明' } })
    await fireEvent.click(screen.getByRole('button', { name: '说明' }))
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('旧说明'))

    await view.rerender({ text: '新说明', label: '说明' })
    expect(screen.getByRole('tooltip').textContent).toBe('新说明')

    await view.rerender({ text: '', label: '说明' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('button', { name: '说明' }).getAttribute('aria-describedby')).toBeNull()
  })

  it('销毁后窗口事件不再改动已卸载实例（取消 rAF、退订 store）', async () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const view = render(Tooltip, { props: { text: '说明文字' } })
    await fireEvent.mouseEnter(view.container.querySelector('.ui-tooltip') as HTMLElement)
    view.unmount()

    expect(cancel).toHaveBeenCalled()
    expect(document.querySelector('.ui-tooltip-bubble')).toBeNull()
    await fireEvent.keyDown(window, { key: 'Escape' })
    cancel.mockRestore()
  })
})
