// 根元素主题 / 背景变量与自定义 CSS 的写入。
//
// App 以前在一条依赖整个 publicData 的响应式语句里同时写主题、背景变量和自定义 CSS：
// 任何数据变化（点击计数、图标状态、书签增删）都会重写 <style id="custom-css-inject">
// 的 textContent（触发整页样式重算）并重设三项根变量。现在拆成两个互不牵连的写入口，
// 并且内容不变时直接跳过写入。

export const ROOT_HOME_BACKGROUND_PROPERTIES = [
  '--home-background',
  '--home-background-mask',
  '--home-background-mask-color',
] as const

export const CUSTOM_CSS_STYLE_ID = 'custom-css-inject'

export interface RootThemeInput {
  theme: string
  backgroundPresetId: string
  backgroundStyle: string
}

export function createRootStyleWriter(doc: Document) {
  let lastTheme: RootThemeInput | null = null
  let lastCss: string | null = null

  return {
    /** 返回是否真的写了 DOM（便于测试与诊断）。 */
    applyTheme(input: RootThemeInput): boolean {
      if (lastTheme && lastTheme.theme === input.theme && lastTheme.backgroundPresetId === input.backgroundPresetId &&
        lastTheme.backgroundStyle === input.backgroundStyle) return false
      const root = doc.documentElement
      root.dataset.theme = input.theme
      root.dataset.backgroundPreset = input.backgroundPresetId
      // 移动端回弹会露出固定首页层之外的根画布，背景变量同步到根元素。
      const parsed = doc.createElement('div').style
      parsed.cssText = input.backgroundStyle
      for (const property of ROOT_HOME_BACKGROUND_PROPERTIES) {
        const value = parsed.getPropertyValue(property)
        if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value)
      }
      lastTheme = { ...input }
      return true
    },
    /** OD-01：自定义 CSS 注入。内容未变时不碰 <style>，避免整页样式重算。 */
    applyCustomCss(css: string): boolean {
      let styleTag = doc.getElementById(CUSTOM_CSS_STYLE_ID)
      if (styleTag && css === lastCss) return false
      if (!styleTag) {
        styleTag = doc.createElement('style')
        styleTag.id = CUSTOM_CSS_STYLE_ID
        doc.head.appendChild(styleTag)
      }
      if (styleTag.textContent !== css) styleTag.textContent = css
      lastCss = css
      return true
    },
  }
}
