import { describe, expect, it } from 'vitest'
import { gradientPresets } from '../../src/lib/themePresets'
import { getPresetRenderTokens, presetRenderTokens } from '../../src/lib/themePresetRender'

// 首屏只打包渲染所需的预设颜色；完整预设随设置 chunk 懒加载。两份数据必须逐项一致。
describe('preset render tokens', () => {
  it('match every full preset field used by home rendering', () => {
    expect(Object.keys(presetRenderTokens).sort()).toEqual(gradientPresets.map((preset) => preset.id).sort())
    for (const preset of gradientPresets) {
      const tokens = presetRenderTokens[preset.id]
      for (const key of Object.keys(tokens) as Array<keyof typeof tokens>) expect([preset.id, key, tokens[key]]).toEqual([preset.id, key, preset[key]])
    }
  })

  it('looks up only known ids', () => {
    expect(getPresetRenderTokens('paper-sage')?.surface).toBe('flat')
    expect(getPresetRenderTokens('custom')).toBeUndefined()
    expect(getPresetRenderTokens('toString')).toBeUndefined()
    expect(getPresetRenderTokens(null)).toBeUndefined()
  })
})
