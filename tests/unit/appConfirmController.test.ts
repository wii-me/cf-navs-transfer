import { describe, expect, it, vi } from 'vitest'
import {
  createConfirmController,
  createConfirmDialogState,
  createDeleteBookmarkConfirmation,
  type ConfirmDialogState,
} from '../../src/lib/appConfirmDialog'

function setup() {
  const states: Array<ConfirmDialogState | null> = []
  let current: ConfirmDialogState | null = null
  const controller = createConfirmController((next) => {
    current = next
    states.push(next)
  })
  return { controller, states, current: () => current }
}

const first = { title: '第一个', message: 'A' }
const second = createDeleteBookmarkConfirmation('书签 B')

describe('confirm dialog controller', () => {
  it('starts closed and publishes the normalized state on request', () => {
    const { controller, states, current } = setup()
    expect(controller.getState()).toBeNull()

    void controller.request(first)

    expect(states).toEqual([createConfirmDialogState(first)])
    expect(current()).toEqual(createConfirmDialogState(first))
    expect(controller.getState()).toEqual(createConfirmDialogState(first))
  })

  it('resolves true on confirm and false on cancel', async () => {
    const { controller } = setup()

    const confirmed = controller.request(first)
    controller.close(true)
    await expect(confirmed).resolves.toBe(true)

    const cancelled = controller.request(second)
    controller.close(false)
    await expect(cancelled).resolves.toBe(false)
    expect(controller.getState()).toBeNull()
  })

  it('clears the state before the awaiting caller resumes', async () => {
    const { controller, current } = setup()
    const seen: Array<ConfirmDialogState | null> = []

    const pending = controller.request(first).then((value) => {
      seen.push(current(), controller.getState())
      return value
    })
    controller.close(true)

    await expect(pending).resolves.toBe(true)
    expect(seen).toEqual([null, null])
  })

  it('supersedes an open request with false and keeps the newer dialog open', async () => {
    const { controller, states, current } = setup()
    const order: string[] = []
    let stateWhenFirstResumed: ConfirmDialogState | null = null

    const a = controller.request(first).then((value) => {
      order.push(`a:${value}`)
      stateWhenFirstResumed = current()
      return value
    })
    const b = controller.request(second).then((value) => {
      order.push(`b:${value}`)
      return value
    })

    // 两个状态之间不推送 null：新确认框直接替换旧的。
    expect(states).toEqual([createConfirmDialogState(first), createConfirmDialogState(second)])

    await expect(a).resolves.toBe(false)
    // 被顶替的请求恢复执行时，新的确认框已经打开。
    expect(stateWhenFirstResumed).toEqual(createConfirmDialogState(second))
    expect(order).toEqual(['a:false'])

    controller.close(true)
    await expect(b).resolves.toBe(true)
    expect(order).toEqual(['a:false', 'b:true'])
    expect(states.at(-1)).toBeNull()
  })

  it('lets a superseded caller open another confirmation, superseding the current one', async () => {
    const { controller, current } = setup()
    const third = { title: '第三个', message: 'C' }
    let c: Promise<boolean> | null = null

    const a = controller.request(first).then(() => {
      c = controller.request(third)
    })
    const b = controller.request(second)

    await a
    await expect(b).resolves.toBe(false)
    expect(current()).toEqual(createConfirmDialogState(third))

    controller.close(true)
    await expect(c).resolves.toBe(true)
  })

  it('does not resolve twice on repeated close and tolerates close without a request', async () => {
    const { controller, states } = setup()
    const onResolved = vi.fn()

    controller.close(true)
    expect(states).toEqual([null])

    const pending = controller.request(first).then(onResolved)
    controller.close(true)
    controller.close(false)
    await pending

    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith(true)
    // 每次 close 都推送一次 null（与原先无条件赋值一致）。
    expect(states).toEqual([null, createConfirmDialogState(first), null, null])
  })

  it('keeps the original single-resolver semantics after a superseded request', async () => {
    const { controller } = setup()
    const a = controller.request(first)
    const b = controller.request(second)

    controller.close(false)
    controller.close(true)

    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
  })
})

// 差分对照：逐字复刻抽出前 App.svelte 的 requestConfirmation / closeConfirmDialog，
// 用同一组交错操作驱动两者，比对状态推送序列与 promise 兑现顺序。
function createOriginalApp(log: string[]) {
  let confirmDialog: ConfirmDialogState | null = null
  let confirmDialogResolver: ((confirmed: boolean) => void) | null = null
  const assign = (next: ConfirmDialogState | null) => {
    confirmDialog = next
    log.push(`state:${next?.title ?? 'null'}`)
  }
  return {
    request(options: Parameters<typeof createConfirmDialogState>[0]): Promise<boolean> {
      confirmDialogResolver?.(false)
      return new Promise((resolve) => {
        confirmDialogResolver = resolve
        assign(createConfirmDialogState(options))
      })
    },
    close(confirmed: boolean): void {
      const resolver = confirmDialogResolver
      confirmDialogResolver = null
      assign(null)
      resolver?.(confirmed)
    },
    getState: () => confirmDialog,
  }
}

function createExtractedApp(log: string[]) {
  return createConfirmController((next) => {
    log.push(`state:${next?.title ?? 'null'}`)
  })
}

type Step = { request: string } | { close: boolean } | { tick: true }

async function drive(impl: ReturnType<typeof createOriginalApp>, log: string[], steps: Step[]) {
  const pending: Promise<void>[] = []
  for (const step of steps) {
    if ('request' in step) {
      const title = step.request
      pending.push(impl.request({ title, message: title }).then((value) => {
        log.push(`resolved:${title}:${value}:open=${impl.getState()?.title ?? 'null'}`)
      }))
    } else if ('close' in step) {
      impl.close(step.close)
    } else {
      await Promise.resolve()
    }
  }
  impl.close(false)
  await Promise.all(pending)
}

describe('confirm dialog controller vs original App implementation', () => {
  const scenarios: Array<[string, Step[]]> = [
    ['single confirm', [{ request: 'A' }, { close: true }]],
    ['single cancel', [{ request: 'A' }, { close: false }]],
    ['overlap then confirm', [{ request: 'A' }, { request: 'B' }, { close: true }]],
    ['overlap with ticks', [{ request: 'A' }, { tick: true }, { request: 'B' }, { tick: true }, { request: 'C' }, { close: true }]],
    ['close storms', [{ close: true }, { request: 'A' }, { close: true }, { close: false }, { request: 'B' }]],
    ['reopen after close', [{ request: 'A' }, { close: false }, { request: 'B' }, { close: true }, { request: 'C' }]],
  ]

  for (const [name, steps] of scenarios) {
    it(name, async () => {
      const originalLog: string[] = []
      const extractedLog: string[] = []
      await drive(createOriginalApp(originalLog), originalLog, steps)
      await drive(createExtractedApp(extractedLog), extractedLog, steps)
      expect(extractedLog).toEqual(originalLog)
    })
  }
})
