// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import Install from '../../src/views/Install.svelte'
import Recover from '../../src/views/Recover.svelte'
import { ApiError } from '../../src/lib/api'
import { ErrCode } from '../../shared/types'
import { SETUP_TOKEN_ASCII_ERROR } from '../../src/lib/setupTokenInput'

// 代码审查三轮第 23 项（APP_SPLIT_PLAN 第 8f 步）：迁移前写成的行为基线。
// Install / Recover 由 App（runes）以动态组件挂载，只收 props 与回调，没有 bind: / 插槽 / dispatcher。
// 这里钉住表单校验顺序、提交载荷、错误优先级、props 变化后的重渲染与按钮回调；迁移为 runes 时本文件不应改动。

const recover = vi.fn()

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, auth: { ...actual.api.auth, recover: (...args: unknown[]) => recover(...args) } },
  }
})

afterEach(() => {
  cleanup()
  recover.mockReset()
})

type InstallProps = Record<string, unknown>

function renderInstall(props: InstallProps = {}) {
  const onInstall = vi.fn()
  const onRetryStatus = vi.fn()
  const view = render(Install, { props: { onInstall, onRetryStatus, ...props } })
  return { onInstall, onRetryStatus, ...view }
}

async function fillInstall(token: string, user: string, pw: string, confirm = pw) {
  await fireEvent.input(screen.getByLabelText('部署密钥'), { target: { value: token } })
  await fireEvent.input(screen.getByLabelText('管理员用户名'), { target: { value: user } })
  await fireEvent.input(screen.getByLabelText('管理员密码'), { target: { value: pw } })
  await fireEvent.input(screen.getByLabelText('再次输入密码'), { target: { value: confirm } })
}

async function submitInstall() {
  await fireEvent.submit(screen.getByRole('button', { name: '完成安装并登录' }).closest('form') as HTMLFormElement)
  await tick()
}

const alertText = () => screen.queryByRole('alert')?.textContent ?? ''

describe('Install：安装表单', () => {
  it('默认用户名 admin，按顺序校验并给出首个错误', async () => {
    const { onInstall } = renderInstall()
    expect((screen.getByLabelText('管理员用户名') as HTMLInputElement).value).toBe('admin')

    await submitInstall()
    expect(alertText()).toContain('请输入部署时配置的 SETUP_TOKEN。')

    await fillInstall('ｔｏｋｅｎ', 'admin', 'x')
    await submitInstall()
    expect(alertText()).toContain(SETUP_TOKEN_ASCII_ERROR)

    await fillInstall('token', '   ', 'x')
    await submitInstall()
    expect(alertText()).toContain('请输入管理员用户名。')

    await fillInstall('token', 'root', 'short')
    await submitInstall()
    expect(alertText()).toContain('管理员密码至少需要 12 个字符。')

    await fillInstall('token', 'root', 'abcdefghijkl', 'abcdefghijkm')
    await submitInstall()
    expect(alertText()).toContain('两次输入的管理员密码不一致。')
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('提交时去掉令牌与用户名两端空白、密码原样，并清除本地错误', async () => {
    const { onInstall } = renderInstall()
    await submitInstall()
    expect(alertText()).toContain('SETUP_TOKEN')

    await fillInstall('  tok-1  ', '  root ', ' pass word 12 ')
    await submitInstall()
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onInstall).toHaveBeenCalledWith({ setupToken: 'tok-1', username: 'root', password: ' pass word 12 ' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('本地错误优先于 error prop；error prop 变化后重渲染；重新检查按钮调用 onRetryStatus', async () => {
    const { onRetryStatus, rerender } = renderInstall({ error: '服务端失败' })
    expect(alertText()).toContain('服务端失败')

    await submitInstall()
    expect(alertText()).toContain('请输入部署时配置的 SETUP_TOKEN。')
    expect(alertText()).not.toContain('服务端失败')

    await fillInstall('tok', 'root', 'abcdefghijkl')
    await submitInstall()
    expect(alertText()).toContain('服务端失败')

    await rerender({ error: '另一个错误' })
    expect(alertText()).toContain('另一个错误')

    await fireEvent.click(screen.getByRole('button', { name: '重新检查安装状态' }))
    expect(onRetryStatus).toHaveBeenCalledTimes(1)

    await rerender({ error: '' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('installing 时禁用输入与按钮并显示进度文案', async () => {
    const { rerender } = renderInstall({ installing: true, error: 'x' })
    expect((screen.getByLabelText('部署密钥') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('管理员密码') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '正在创建管理员…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '重新检查安装状态' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '正在创建管理员…' }).closest('form')?.getAttribute('aria-busy')).toBe('true')

    await rerender({ installing: false })
    expect((screen.getByRole('button', { name: '完成安装并登录' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('submit 默认行为被阻止', async () => {
    renderInstall()
    const form = screen.getByRole('button', { name: '完成安装并登录' }).closest('form') as HTMLFormElement
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('Install：配置面板', () => {
  it.each([
    ['setup_token_missing', '还缺少部署密钥', '重新检查配置'],
    ['database_unreachable', '数据库暂时不可用', '重试数据库检查'],
    ['session_store_unreachable', '会话存储暂时不可用', '重试会话存储检查'],
    ['status_error', '无法检查安装状态', '重新检查安装状态'],
  ])('%s 显示对应标题与按钮', async (mode, title, action) => {
    const { onRetryStatus } = renderInstall({ mode })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(title)
    expect(screen.queryByLabelText('部署密钥')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: action }))
    expect(onRetryStatus).toHaveBeenCalledTimes(1)
  })

  it('缺少绑定时列出绑定名，空列表回落为 DB / SESSION；显示结构版本与检查错误', async () => {
    const { rerender } = renderInstall({ mode: 'bindings_missing', missingBindings: ['DB', 'SESSION'], schemaVersion: 7, error: '仍然缺失' })
    expect(screen.getByText(/请在 Cloudflare 中配置 DB、SESSION 绑定/)).toBeTruthy()
    expect(screen.getByText(/已检测到数据库结构版本 7/)).toBeTruthy()
    expect(alertText()).toContain('检查未完成')
    expect(alertText()).toContain('仍然缺失')
    cleanup()

    renderInstall({ mode: 'bindings_missing', missingBindings: [] })
    expect(screen.getByText(/请在 Cloudflare 中配置 DB \/ SESSION 绑定/)).toBeTruthy()
    expect(screen.queryByText(/数据库结构版本/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    void rerender
  })

  it('mode 在配置态与安装态之间切换时重渲染', async () => {
    const { rerender } = renderInstall({ mode: 'database_unreachable' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('数据库暂时不可用')

    await rerender({ mode: 'setup_token_missing' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('还缺少部署密钥')

    await rerender({ mode: 'needs_install' })
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.getByLabelText('部署密钥')).toBeTruthy()

    await rerender({ mode: 'session_store_unreachable' })
    expect(screen.getByRole('button', { name: '重试会话存储检查' })).toBeTruthy()
  })
})

function renderRecover() {
  const onRecovered = vi.fn()
  const onGoInstall = vi.fn()
  const onCancel = vi.fn()
  render(Recover, { props: { onRecovered, onGoInstall, onCancel } })
  return { onRecovered, onGoInstall, onCancel }
}

async function fillRecover(token: string, pw: string, confirm = pw) {
  await fireEvent.input(screen.getByLabelText('部署密钥'), { target: { value: token } })
  await fireEvent.input(screen.getByLabelText('新密码'), { target: { value: pw } })
  await fireEvent.input(screen.getByLabelText('再次输入新密码'), { target: { value: confirm } })
}

async function submitRecover() {
  await fireEvent.submit(screen.getByRole('button', { name: /重置并登录|正在重置/ }).closest('form') as HTMLFormElement)
  await tick()
}

describe('Recover：补充行为', () => {
  it('返回登录 / 前往初始化按钮调用各自回调', async () => {
    const { onCancel, onGoInstall } = renderRecover()
    await fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onGoInstall).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '站点未安装？前往初始化' }))
    expect(onGoInstall).toHaveBeenCalledTimes(1)
  })

  it('提交中禁用表单，结束后恢复；令牌去空白后传给 API', async () => {
    let resolve!: (v: unknown) => void
    recover.mockReturnValue(new Promise((r) => { resolve = r }))
    const { onRecovered } = renderRecover()
    await fillRecover('  tok  ', 'Abcdef12')
    await submitRecover()

    expect(recover).toHaveBeenCalledWith({ password: 'Abcdef12' }, 'tok')
    expect((screen.getByRole('button', { name: '正在重置…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '返回登录' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('部署密钥') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '正在重置…' }).closest('form')?.getAttribute('aria-busy')).toBe('true')

    resolve({ ok: true })
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledWith({ ok: true }))
    await tick()
    expect((screen.getByRole('button', { name: '重置并登录' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('再次提交时先清除服务端错误与令牌提示；未安装与未知错误映射', async () => {
    recover.mockRejectedValueOnce(new ApiError('bad', { status: 401, code: ErrCode.UNAUTHORIZED }))
    renderRecover()
    await fillRecover('tok', 'Abcdef12')
    await submitRecover()
    await vi.waitFor(() => expect(alertText()).toContain('令牌无效或未配置。'))
    expect(alertText()).toContain('SETUP_TOKEN')

    await fillRecover('tok', 'abc')
    await submitRecover()
    expect(alertText()).toContain('新密码需为 8–12 位。')
    expect(alertText()).not.toContain('令牌无效')
    expect(screen.queryByText(/若忘记原令牌/)).toBeNull()

    recover.mockRejectedValueOnce(new ApiError('not installed', { status: 400, code: ErrCode.BAD_REQUEST }))
    await fillRecover('tok', 'Abcdef12')
    await submitRecover()
    await vi.waitFor(() => expect(alertText()).toContain('站点尚未安装，请先完成初始化。'))

    recover.mockRejectedValueOnce(new Error('boom'))
    await submitRecover()
    await vi.waitFor(() => expect(alertText()).not.toContain('站点尚未安装'))
    expect(screen.getByRole('alert')).toBeTruthy()

    recover.mockReturnValueOnce(new Promise(() => {}))
    await submitRecover()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('不满足两类字符时拒绝；submit 默认行为被阻止', async () => {
    renderRecover()
    await fillRecover('tok', 'abcdefgh')
    await submitRecover()
    expect(alertText()).toContain('新密码需包含至少两类字符')
    expect(recover).not.toHaveBeenCalled()

    const form = screen.getByRole('button', { name: '重置并登录' }).closest('form') as HTMLFormElement
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
