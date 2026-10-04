// Recovery belongs to the mounted icon, not a global result cache. Retries are
// bounded per icon identity; later focus/online events allow one rate-limited probe.
const RETRY_DELAYS_MS = [1200, 4000, 10000]
const RECOVERY_COOLDOWN_MS = 30000

export function createIconRetry(retry: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let pending = false
  let listening = false
  let disposed = false
  let lastAttempt = Number.NEGATIVE_INFINITY

  function canRun(): boolean {
    return typeof document === 'undefined' || (document.visibilityState !== 'hidden' && navigator.onLine !== false)
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function run(): void {
    clearTimer()
    if (disposed || !pending || !canRun()) return
    pending = false
    attempts += 1
    lastAttempt = Date.now()
    retry()
  }

  function wake(): void {
    const cooldown = attempts < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[0] : RECOVERY_COOLDOWN_MS
    if (pending && Date.now() - lastAttempt >= cooldown) run()
  }

  function stopListening(): void {
    if (!listening) return
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
    document.removeEventListener('visibilitychange', wake)
    listening = false
  }

  function reset(): void {
    clearTimer()
    stopListening()
    pending = false
    attempts = 0
    lastAttempt = Number.NEGATIVE_INFINITY
  }

  return {
    failed(): void {
      if (disposed) return
      pending = true
      if (!listening && typeof window !== 'undefined') {
        window.addEventListener('focus', wake)
        window.addEventListener('online', wake)
        document.addEventListener('visibilitychange', wake)
        listening = true
      }
      if (timer === null && attempts < RETRY_DELAYS_MS.length) {
        timer = setTimeout(run, RETRY_DELAYS_MS[attempts])
      }
    },
    reset,
    dispose(): void { disposed = true; reset() },
  }
}
