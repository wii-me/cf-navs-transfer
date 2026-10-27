// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import AppSplash from '../../src/components/AppSplash.svelte'

// 代码审查三轮第 9 项：App.svelte 原有三段 splash 模板合并为 AppSplash。
// 下面的期望标记逐字取自合并前的 App.svelte 模板（启动段按 lazyViewError 两个分支展开），
// 渲染结果必须与之 DOM 等价：元素、命名空间、属性（不计顺序）与文本完全一致。
const ORIGINAL = {
  boot: `
<div class="app-splash">
  <div class="app-splash-card app-splash-card--loading" role="status" aria-live="polite" aria-busy="true">
    <div class="app-splash-mark" aria-hidden="true">
      <svg class="app-splash-spinner" viewBox="0 0 50 50">
        <circle class="ring" cx="25" cy="25" r="20" fill="none" stroke="url(#splash-spinner-grad-boot)" stroke-width="3.5"></circle>
        <circle class="dot" cx="25" cy="25" r="4.5" fill="#2dd4bf"></circle>
        <defs>
          <linearGradient id="splash-spinner-grad-boot" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="60%" stop-color="#2dd4bf"></stop>
            <stop offset="100%" stop-color="#bef264"></stop>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <p class="eyebrow">CF-Navs</p>
    <h1>正在加载项目数据...</h1>
    <p>前端状态与后端接口正在初始化，请稍候。</p>
    <div class="app-splash-progress" aria-hidden="true">
      <div class="app-splash-progress-meta">
        <span>初始化数据</span>
        <span>同步中</span>
      </div>
      <div class="app-splash-track">
        <span class="app-splash-bar"></span>
      </div>
    </div>
  </div>
</div>
`,
  bootError: `
<div class="app-splash">
  <div class="app-splash-card app-splash-card--loading" role="status" aria-live="polite" aria-busy="true">
    <div class="app-splash-mark" aria-hidden="true">
      <svg class="app-splash-spinner" viewBox="0 0 50 50">
        <circle class="ring" cx="25" cy="25" r="20" fill="none" stroke="url(#splash-spinner-grad-boot)" stroke-width="3.5"></circle>
        <circle class="dot" cx="25" cy="25" r="4.5" fill="#2dd4bf"></circle>
        <defs>
          <linearGradient id="splash-spinner-grad-boot" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="60%" stop-color="#2dd4bf"></stop>
            <stop offset="100%" stop-color="#bef264"></stop>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <p class="eyebrow">CF-Navs</p>
    <h1>页面加载失败</h1>
    <p>页面资源加载失败，请检查网络后刷新重试。</p>
    <div class="app-splash-progress" aria-hidden="true">
      <div class="app-splash-progress-meta">
        <span>初始化数据</span>
        <span>同步中</span>
      </div>
      <div class="app-splash-track">
        <span class="app-splash-bar"></span>
      </div>
    </div>
  </div>
</div>
`,
  login: `
<div class="app-splash">
  <div class="app-splash-card">
    <div class="app-splash-mark" aria-hidden="true">
      <svg class="app-splash-spinner" viewBox="0 0 50 50">
        <circle class="ring" cx="25" cy="25" r="20" fill="none" stroke="url(#splash-spinner-grad-login)" stroke-width="3.5"></circle>
        <circle class="dot" cx="25" cy="25" r="4.5" fill="#2dd4bf"></circle>
        <defs>
          <linearGradient id="splash-spinner-grad-login" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="60%" stop-color="#2dd4bf"></stop>
            <stop offset="100%" stop-color="#bef264"></stop>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <p class="eyebrow">CF-Navs</p>
    <h1>请先登录管理员账号</h1>
    <p>当前站点未公开，登录后再加载后台管理界面。</p>
  </div>
</div>
`,
  admin: `
<div class="app-splash">
  <div class="app-splash-card app-splash-card--loading" role="status" aria-live="polite" aria-busy="true">
    <div class="app-splash-mark" aria-hidden="true">
      <svg class="app-splash-spinner" viewBox="0 0 50 50">
        <circle class="ring" cx="25" cy="25" r="20" fill="none" stroke="url(#splash-spinner-grad-admin)" stroke-width="3.5"></circle>
        <circle class="dot" cx="25" cy="25" r="4.5" fill="#2dd4bf"></circle>
        <defs>
          <linearGradient id="splash-spinner-grad-admin" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="60%" stop-color="#2dd4bf"></stop>
            <stop offset="100%" stop-color="#bef264"></stop>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <p class="eyebrow">CF-Navs</p>
    <h1>正在加载后台...</h1>
    <p>管理界面分包正在按需载入。</p>
    <div class="app-splash-progress" aria-hidden="true">
      <div class="app-splash-progress-meta">
        <span>载入模块</span>
        <span>请稍候</span>
      </div>
      <div class="app-splash-track">
        <span class="app-splash-bar"></span>
      </div>
    </div>
  </div>
</div>
`,
}

/** 去掉注释与纯空白文本节点，属性按名排序后序列化，便于比对与读失败信息。 */
function canonical(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim()
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as Element
  const attrs = [...element.attributes]
    .map((attr) => `${attr.name}="${attr.value}"`)
    .sort()
    .join(' ')
  const children = [...element.childNodes].map(canonical).filter(Boolean).join('')
  return `<${element.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg:' : ''}${element.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${children}</${element.tagName.toLowerCase()}>`
}

function parse(html: string): Element {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  return template.content.firstElementChild!
}

function rendered(container: HTMLElement): Element {
  const roots = [...container.children]
  expect(roots).toHaveLength(1)
  return roots[0]
}

afterEach(() => cleanup())

describe('AppSplash', () => {
  it('renders the boot splash exactly like the original App template', () => {
    const { container } = render(AppSplash, {
      props: {
        gradientId: 'splash-spinner-grad-boot',
        loading: true,
        title: '正在加载项目数据...',
        message: '前端状态与后端接口正在初始化，请稍候。',
        progress: { label: '初始化数据', status: '同步中' },
      },
    })
    expect(canonical(rendered(container))).toBe(canonical(parse(ORIGINAL.boot)))
  })

  it('renders the boot splash lazy-view error branch exactly like the original', () => {
    const { container } = render(AppSplash, {
      props: {
        gradientId: 'splash-spinner-grad-boot',
        loading: true,
        title: '页面加载失败',
        message: '页面资源加载失败，请检查网络后刷新重试。',
        progress: { label: '初始化数据', status: '同步中' },
      },
    })
    expect(canonical(rendered(container))).toBe(canonical(parse(ORIGINAL.bootError)))
  })

  it('renders the login gate splash (not loading, no progress) exactly like the original', () => {
    const { container } = render(AppSplash, {
      props: {
        gradientId: 'splash-spinner-grad-login',
        title: '请先登录管理员账号',
        message: '当前站点未公开，登录后再加载后台管理界面。',
      },
    })
    const card = container.querySelector('.app-splash-card')!
    expect(card.className).toBe('app-splash-card')
    expect(card.hasAttribute('role')).toBe(false)
    expect(card.hasAttribute('aria-live')).toBe(false)
    expect(card.hasAttribute('aria-busy')).toBe(false)
    expect(container.querySelector('.app-splash-progress')).toBeNull()
    expect(canonical(rendered(container))).toBe(canonical(parse(ORIGINAL.login)))
  })

  it('renders the admin chunk-loading splash exactly like the original', () => {
    const { container } = render(AppSplash, {
      props: {
        gradientId: 'splash-spinner-grad-admin',
        loading: true,
        title: '正在加载后台...',
        message: '管理界面分包正在按需载入。',
        progress: { label: '载入模块', status: '请稍候' },
      },
    })
    const actual = rendered(container)
    expect(container.querySelector('.app-splash-card')!.className).toBe('app-splash-card app-splash-card--loading')
    expect(canonical(actual)).toBe(canonical(parse(ORIGINAL.admin)))
  })

  it('keeps the spinner gradient reference wired to its own id', () => {
    const { container } = render(AppSplash, {
      props: { gradientId: 'splash-spinner-grad-admin', title: 't', message: 'm' },
    })
    const gradient = container.querySelector('linearGradient')!
    expect(gradient.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(gradient.id).toBe('splash-spinner-grad-admin')
    expect(container.querySelector('circle.ring')!.getAttribute('stroke')).toBe('url(#splash-spinner-grad-admin)')
  })
})
