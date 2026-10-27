// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import SearchEngineSettingsSection from '../../src/components/settings/SearchEngineSettingsSection.svelte'
import { createSettingsFormState } from '../../src/lib/settingsForm'
import { reactiveState } from '../helpers/reactiveState.svelte'

afterEach(cleanup)

// 第 8j 步起 SettingsPanel 的 form 是 $state：这里同样传深层代理，模拟真实父组件。
function engineForm() {
  return reactiveState(createSettingsFormState({
    search_engine: {
      current: 'Google',
      engines: [
        { name: 'Google', icon: '', url_template: 'https://www.google.com/search?q={q}' },
        { name: 'Bing', icon: '', url_template: 'https://www.bing.com/search?q={q}' },
      ],
    },
  }))
}

describe('默认搜索引擎下拉的真实事件序列（Issue #25 复现）', () => {
  it('原生 select 的 input 阶段即提交 current，后续 clone 不会重置选择', async () => {
    // 真实交互里原生 select 先派发 input 再派发 change；Svelte 的 bind:value 只在
    // change 提交，而 fieldset 的 on:input 会先 cloneSettingsForm（此刻 current 仍是旧值），
    // 把用户刚选中的选项重置回去。select 必须在自己这一层于 input 阶段立即提交。
    const form = engineForm()
    const { container } = render(SearchEngineSettingsSection, { props: { form, saving: false, enginesValid: true } })
    // 测试程序同时加载了 @cloudflare/workers-types，其 HTMLRewriter 的 Element 会并入 DOM Element，
    // 导致 HTMLSelectElement 与之不再兼容，只能经 unknown 收窄。
    const select = container.querySelector('label.field-select select') as unknown as HTMLSelectElement
    expect(select.value).toBe('Google')

    select.value = 'Bing'
    fireEvent.input(select)
    await tick()

    expect(form.search_engine.current).toBe('Bing')
  })

  it('input + change 完整序列后 current 保持为用户选择', async () => {
    const form = engineForm()
    const { container } = render(SearchEngineSettingsSection, { props: { form, saving: false, enginesValid: true } })
    const select = container.querySelector('label.field-select select') as unknown as HTMLSelectElement

    select.value = 'Bing'
    fireEvent.input(select)
    await tick()
    fireEvent.change(select)
    await tick()

    expect(form.search_engine.current).toBe('Bing')
    expect(select.value).toBe('Bing')
  })
})
