// Releasable bounded-concurrency scheduler for ordinary same-origin object icon
// proxy requests (/api/icon/). Pure mechanism: no DOM, Svelte, fetch or
// IndexedDB coupling. It bounds how many icon loads run at once, prefers
// visible work over preloads, deduplicates concurrent requests for the same
// key, and lets callers release (cancel) a reservation that is still queued or
// in flight. Concurrency is injected by the caller; this module never presumes
// a product value (4/6/8 are decided by later experiments).

export type OrdinaryIconPriority = 'visible' | 'preload'

export interface OrdinaryIconReservation<T> {
  readonly promise: Promise<T>
  release(): void
}

export type OrdinaryIconSchedulerEvent =
  | { type: 'queued'; key: string; priority: OrdinaryIconPriority; queueDepth: number }
  | { type: 'started'; key: string; waitedMs: number; inFlight: number }
  | { type: 'settled'; key: string; outcome: 'fulfilled' | 'rejected'; runMs: number }
  | { type: 'cancelled'; key: string; started: boolean }

export interface OrdinaryIconSchedulerOptions<T> {
  concurrency: number
  run: (key: string, signal: AbortSignal) => Promise<T>
  onEvent?: (event: OrdinaryIconSchedulerEvent) => void
  now?: () => number
}

export interface OrdinaryIconScheduler<T> {
  reserve(key: string, priority?: OrdinaryIconPriority): OrdinaryIconReservation<T>
  setConcurrency(n: number): void
  readonly inFlight: number
  readonly queued: number
}

export class OrdinaryIconCancelledError extends Error {
  constructor(message = 'ordinary icon reservation cancelled') {
    super(message)
    this.name = 'OrdinaryIconCancelledError'
  }
}

type EntryState = 'queued' | 'running' | 'settled'

interface Entry<T> {
  key: string
  state: EntryState
  priority: OrdinaryIconPriority
  refs: number
  enqueuedAt: number
  startedAt: number
  controller: AbortController | null
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function createOrdinaryIconScheduler<T>(options: OrdinaryIconSchedulerOptions<T>): OrdinaryIconScheduler<T> {
  const now = options.now ?? Date.now
  const emit = options.onEvent
  const run = options.run
  let concurrency = Math.max(1, Math.floor(options.concurrency))

  const entries = new Map<string, Entry<T>>()
  // One FIFO queue per priority; visible always drains before preload.
  const visibleQueue: Array<Entry<T>> = []
  const preloadQueue: Array<Entry<T>> = []
  let inFlightCount = 0

  function removeFromQueue(entry: Entry<T>): void {
    const queue = entry.priority === 'visible' ? visibleQueue : preloadQueue
    const index = queue.indexOf(entry)
    if (index !== -1) queue.splice(index, 1)
  }

  function start(entry: Entry<T>): void {
    const controller = new AbortController()
    entry.state = 'running'
    entry.startedAt = now()
    entry.controller = controller
    inFlightCount++
    emit?.({ type: 'started', key: entry.key, waitedMs: entry.startedAt - entry.enqueuedAt, inFlight: inFlightCount })
    run(entry.key, controller.signal).then(
      value => settle(entry, 'fulfilled', value),
      reason => settle(entry, 'rejected', reason),
    )
  }

  function settle(entry: Entry<T>, outcome: 'fulfilled' | 'rejected', result: unknown): void {
    // A promise settles once, so this guard only defends against a release path
    // that already finalized the entry; it never double-emits settled.
    if (entry.state === 'settled') return
    entry.state = 'settled'
    emit?.({ type: 'settled', key: entry.key, outcome, runMs: now() - entry.startedAt })
    entries.delete(entry.key)
    inFlightCount--
    if (outcome === 'fulfilled') entry.resolve(result as T)
    else entry.reject(result)
    pump()
  }

  function pump(): void {
    while (inFlightCount < concurrency) {
      const entry = visibleQueue.shift() ?? preloadQueue.shift()
      if (!entry) break
      start(entry)
    }
  }

  function reserve(key: string, priority: OrdinaryIconPriority = 'visible'): OrdinaryIconReservation<T> {
    let entry = entries.get(key)
    if (!entry) {
      let resolve!: (value: T) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      entry = {
        key,
        state: 'queued',
        priority,
        refs: 1,
        enqueuedAt: now(),
        startedAt: 0,
        controller: null,
        promise,
        resolve,
        reject,
      }
      entries.set(key, entry)
      const queue = priority === 'visible' ? visibleQueue : preloadQueue
      queue.push(entry)
      emit?.({ type: 'queued', key, priority, queueDepth: visibleQueue.length + preloadQueue.length })
      pump()
    } else {
      entry.refs++
      // Only ever promote toward visibility; a later preload never demotes an
      // existing reservation. Running entries have already left the queue.
      if (entry.state === 'queued' && priority === 'visible' && entry.priority === 'preload') {
        removeFromQueue(entry)
        entry.priority = 'visible'
        visibleQueue.push(entry)
      }
    }

    const owner = entry
    let released = false
    return {
      promise: owner.promise,
      release(): void {
        if (released) return
        released = true
        owner.refs--
        if (owner.refs > 0) return
        if (owner.state === 'queued') {
          removeFromQueue(owner)
          owner.state = 'settled'
          entries.delete(owner.key)
          emit?.({ type: 'cancelled', key: owner.key, started: false })
          owner.reject(new OrdinaryIconCancelledError())
          pump()
        } else if (owner.state === 'running') {
          // Leave teardown to the run promise's AbortError, which flows through
          // the normal settled -> reject path; only signal the cancellation here.
          owner.controller?.abort()
          emit?.({ type: 'cancelled', key: owner.key, started: true })
        }
      },
    }
  }

  function setConcurrency(n: number): void {
    concurrency = Math.max(1, Math.floor(n))
    pump()
  }

  return {
    reserve,
    setConcurrency,
    get inFlight() {
      return inFlightCount
    },
    get queued() {
      return visibleQueue.length + preloadQueue.length
    },
  }
}
