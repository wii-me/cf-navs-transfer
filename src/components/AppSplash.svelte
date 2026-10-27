<svelte:options runes />

<script lang="ts">
  // 启动 / 登录闸门 / 后台分包加载三处共用的 splash（代码审查三轮第 9 项，从 App.svelte 去重）。
  // 样式在 app.css 的全局 .app-splash* 规则里，本组件不带 <style>。
  interface Props {
    /** 渐变 id，SVG 内 stroke 引用它；同页可能同时存在多个 splash 时须各不相同。 */
    gradientId: string
    title: string
    message: string
    /** 加载态：卡片加 --loading 修饰并作为 status 播报（aria-busy）。 */
    loading?: boolean
    /** 底部进度条两侧文案；null 时不渲染进度条。 */
    progress?: { label: string; status: string } | null
  }

  let { gradientId, title, message, loading = false, progress = null }: Props = $props()
</script>

<div class="app-splash">
  <div
    class="app-splash-card"
    class:app-splash-card--loading={loading}
    role={loading ? 'status' : undefined}
    aria-live={loading ? 'polite' : undefined}
    aria-busy={loading ? 'true' : undefined}
  >
    <div class="app-splash-mark" aria-hidden="true">
      <svg class="app-splash-spinner" viewBox="0 0 50 50">
        <circle class="ring" cx="25" cy="25" r="20" fill="none" stroke="url(#{gradientId})" stroke-width="3.5"></circle>
        <circle class="dot" cx="25" cy="25" r="4.5" fill="#2dd4bf"></circle>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"></stop>
            <stop offset="60%" stop-color="#2dd4bf"></stop>
            <stop offset="100%" stop-color="#bef264"></stop>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <p class="eyebrow">CF-Navs</p>
    <h1>{title}</h1>
    <p>{message}</p>
    {#if progress}
      <div class="app-splash-progress" aria-hidden="true">
        <div class="app-splash-progress-meta">
          <span>{progress.label}</span>
          <span>{progress.status}</span>
        </div>
        <div class="app-splash-track">
          <span class="app-splash-bar"></span>
        </div>
      </div>
    {/if}
  </div>
</div>
