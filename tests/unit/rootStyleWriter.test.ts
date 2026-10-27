// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { CUSTOM_CSS_STYLE_ID, createRootStyleWriter } from '../../src/lib/rootStyleWriter'

afterEach(() => {
  document.getElementById(CUSTOM_CSS_STYLE_ID)?.remove()
  document.documentElement.removeAttribute('style')
})

function watchMutations() {
  const observer = new MutationObserver(() => undefined)
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
  return () => { const records = observer.takeRecords(); observer.disconnect(); return records }
}

describe('createRootStyleWriter', () => {
  const theme = { theme: 'dark', backgroundPresetId: 'custom', backgroundStyle: '--home-background: #000; --home-background-mask: 0.3; --home-background-mask-color: #111' }

  it('writes theme variables once and skips unchanged input', () => {
    const writer = createRootStyleWriter(document)
    expect(writer.applyTheme(theme)).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--home-background')).toBe('#000')
    const take = watchMutations()
    expect(writer.applyTheme({ ...theme })).toBe(false)
    expect(take()).toEqual([])
    expect(writer.applyTheme({ ...theme, theme: 'light' })).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('rewrites custom CSS only when its content changes', () => {
    const writer = createRootStyleWriter(document)
    expect(writer.applyCustomCss('body{color:red}')).toBe(true)
    const style = document.getElementById(CUSTOM_CSS_STYLE_ID)!
    expect(style.textContent).toBe('body{color:red}')
    const take = watchMutations()
    expect(writer.applyCustomCss('body{color:red}')).toBe(false)
    expect(take()).toEqual([])
    expect(writer.applyCustomCss('')).toBe(true)
    expect(style.textContent).toBe('')
    expect(document.querySelectorAll('#' + CUSTOM_CSS_STYLE_ID)).toHaveLength(1)
  })

  it('recreates the style tag if something removed it', () => {
    const writer = createRootStyleWriter(document)
    writer.applyCustomCss('a{}')
    document.getElementById(CUSTOM_CSS_STYLE_ID)!.remove()
    expect(writer.applyCustomCss('a{}')).toBe(true)
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)?.textContent).toBe('a{}')
  })
})
