<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { transferStore } from '../lib/stores/transferStore'
  import { authStore } from '../lib/stores'
  import { getAuthToken } from '../lib/api'
  import { toastStore } from '../lib/toast'

  let textContent = ''
  let selectedTtlDays = 7
  let fileInput: HTMLInputElement | null = null
  let isDragging = false
  let imageErrorMap = new Set<string>()

  $: isOpen = $transferStore.drawerOpen
  $: notes = $transferStore.notes
  $: loading = $transferStore.loading
  $: uploading = $transferStore.uploading
  $: lightboxImage = $transferStore.activeLightboxImage
  $: currentToken = $authStore.session?.token || getAuthToken() || ''

  function getFileUrl(id: string, isDownload = false): string {
    const token = currentToken || $authStore.session?.token || getAuthToken() || ''
    const params = new URLSearchParams()
    if (token) {
      params.set('token', token)
    }
    if (isDownload) {
      params.set('download', '1')
    }
    const qs = params.toString()
    return `/api/transfers/file/${id}${qs ? `?${qs}` : ''}`
  }

  async function handleDownload(event: MouseEvent, id: string, filename: string) {
    event.preventDefault()
    const token = currentToken || $authStore.session?.token || getAuthToken() || ''
    const url = getFileUrl(id, true)
    try {
      toastStore.addToast(`正在下载 ${filename}...`, 'info')
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename || 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)
      toastStore.addToast('下载完成', 'success')
    } catch (err) {
      console.error('Download error:', err)
      window.open(url, '_blank')
    }
  }

  function handleImageError(id: string) {
    imageErrorMap.add(id)
    imageErrorMap = imageErrorMap
  }

  // 当抽屉打开时，拉取最新的记录
  $: if (isOpen) {
    void transferStore.fetchNotes()
  }

  function handleClose() {
    transferStore.closeDrawer()
  }

  async function handleSendText() {
    if (!textContent.trim() || uploading) return
    const contentToSend = textContent.trim()
    const success = await transferStore.sendText(contentToSend, selectedTtlDays > 0 ? selectedTtlDays : undefined)
    if (success) {
      textContent = ''
      toastStore.addToast('文本已发送', 'success')
    }
  }

  function handleTextKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSendText()
    }
  }

  async function handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    await uploadSelectedFile(file)
    input.value = ''
  }

  async function uploadSelectedFile(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      toastStore.addToast('文件过大，单文件不得超过 50MB', 'error')
      return
    }

    toastStore.addToast(`正在上传 ${file.name}...`, 'info')
    const success = await transferStore.uploadFile(file, selectedTtlDays > 0 ? selectedTtlDays : undefined)
    if (success) {
      toastStore.addToast('文件传输成功', 'success')
    }
  }

  async function handleCopyText(text: string) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      toastStore.addToast('已复制到剪贴板', 'success')
    } catch {
      toastStore.addToast('复制失败，请手动选择复制', 'error')
    }
  }

  async function handleDeleteNote(id: string) {
    const success = await transferStore.deleteNote(id)
    if (success) {
      toastStore.addToast('已删除', 'info')
    }
  }

  async function handleClearAll() {
    if (notes.length === 0) return
    if (window.confirm('确定要清空所有传输记录与上传的文件吗？此操作不可恢复。')) {
      const success = await transferStore.clearAll()
      if (success) {
        toastStore.addToast('已清空全部传输记录', 'success')
      }
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (!isOpen) return
    if (event.key === 'Escape') {
      if (lightboxImage) {
        transferStore.closeLightbox()
      } else {
        handleClose()
      }
    }
  }

  function handleWindowPaste(event: ClipboardEvent) {
    if (!isOpen) return
    const items = event.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          event.preventDefault()
          void uploadSelectedFile(file)
          break
        }
      }
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault()
    isDragging = true
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault()
    isDragging = false
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    isDragging = false
    const file = event.dataTransfer?.files?.[0]
    if (file) {
      void uploadSelectedFile(file)
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${m}-${d} ${h}:${min}`
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatExpiration(expiresAt: number | null): string {
    if (!expiresAt) return '永久'
    const diffHours = Math.round((expiresAt - Date.now()) / (1000 * 60 * 60))
    if (diffHours <= 0) return '即将过期'
    if (diffHours < 24) return `${diffHours}小时后过期`
    const days = Math.ceil(diffHours / 24)
    return `${days}天后过期`
  }

  function renderFormattedText(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
    const urlPattern = /(https?:\/\/[^\s<>&"']+)/g
    return escaped.replace(urlPattern, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-url">${url}</a>`)
  }

  onMount(() => {
    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('paste', handleWindowPaste)
  })

  onDestroy(() => {
    window.removeEventListener('keydown', handleWindowKeyDown)
    window.removeEventListener('paste', handleWindowPaste)
  })
</script>

{#if isOpen}
  <!-- 遮罩背景 -->
  <div
    class="drawer-backdrop"
    data-testid="transfer-drawer-backdrop"
    on:click={handleClose}
    role="presentation"
  ></div>

  <!-- 抽屉主体 -->
  <div
    class="drawer-panel"
    data-testid="transfer-drawer-panel"
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    role="dialog"
    aria-modal="true"
    aria-label="传输助手"
    tabindex="-1"
  >
    {#if isDragging}
      <div class="drag-overlay">
        <div class="drag-box">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p>松开鼠标立即上传</p>
        </div>
      </div>
    {/if}

    <!-- 顶部操作栏 -->
    <div class="drawer-header">
      <div class="header-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
        <span>传输助手</span>
      </div>
      <div class="header-actions">
        {#if notes.length > 0}
          <button type="button" class="btn-text danger" on:click={handleClearAll} title="清空全部">
            清空
          </button>
        {/if}
        <button
          type="button"
          class="btn-icon"
          on:click={() => transferStore.fetchNotes()}
          title="刷新列表"
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
          </svg>
        </button>
        <button
          type="button"
          class="btn-icon close-btn"
          data-testid="transfer-drawer-close"
          on:click={handleClose}
          title="关闭 (ESC)"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- 消息流列表 -->
    <div class="drawer-feed">
      {#if loading && notes.length === 0}
        <div class="loading-state">
          <div class="spinner"></div>
          <span>加载传输记录...</span>
        </div>
      {:else if notes.length === 0}
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p class="empty-title">暂无传输内容</p>
          <p class="empty-hint">在下方输入文字，或直接在窗口按 <b>Ctrl+V</b> 粘贴截图、拖拽文件上传。</p>
        </div>
      {:else}
        {#each notes as note (note.id)}
          <div class="note-card" class:type-image={note.type === 'image'}>
            <!-- 卡片头部信息 -->
            <div class="note-header">
              <span class="note-time">{formatTime(note.created_at)}</span>
              <span class="note-expiration" class:is-expired={note.expires_at && note.expires_at < Date.now()}>
                {formatExpiration(note.expires_at)}
              </span>
              <button
                type="button"
                class="note-delete-btn"
                on:click={() => handleDeleteNote(note.id)}
                title="删除此条"
                aria-label="删除"
              >
                &times;
              </button>
            </div>

            <!-- 卡片主体内容 -->
            <div class="note-body">
              {#if note.type === 'text'}
                <div class="text-content">
                  {@html renderFormattedText(note.content || '')}
                </div>
                <div class="card-footer">
                  <button
                    type="button"
                    class="btn-copy"
                    data-testid={`copy-text-${note.id}`}
                    on:click={() => handleCopyText(note.content || '')}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    复制内容
                  </button>
                </div>
              {:else if note.type === 'image'}
                <div class="image-box">
                  {#if imageErrorMap.has(note.id)}
                    <div class="image-error-fallback">
                      <span>⚠️ 图片加载失败</span>
                    </div>
                  {:else}
                    <button
                      type="button"
                      class="image-thumb-btn"
                      on:click={() => transferStore.openLightbox(getFileUrl(note.id))}
                      title="点击放大预览"
                    >
                      <img
                        src={getFileUrl(note.id)}
                        alt={note.file_name || '图片'}
                        loading="eager"
                        on:error={() => handleImageError(note.id)}
                      />
                    </button>
                  {/if}
                </div>
                <div class="file-meta">
                  <span class="filename" title={note.file_name}>{note.file_name}</span>
                  <span class="filesize">{formatFileSize(note.file_size)}</span>
                </div>
                <div class="card-footer">
                  <a
                    href={getFileUrl(note.id, true)}
                    download={note.file_name || 'image'}
                    class="btn-copy"
                    target="_blank"
                    rel="noopener noreferrer"
                    on:click={(e) => handleDownload(e, note.id, note.file_name || 'image.png')}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    下载原图
                  </a>
                </div>
              {:else}
                <!-- 普通文件 -->
                <div class="file-card-content">
                  <div class="file-icon-box">📄</div>
                  <div class="file-info">
                    <span class="filename" title={note.file_name}>{note.file_name}</span>
                    <span class="filesize">{formatFileSize(note.file_size)}</span>
                  </div>
                </div>
                <div class="card-footer">
                  <a
                    href={getFileUrl(note.id, true)}
                    download={note.file_name || 'file'}
                    class="btn-copy"
                    target="_blank"
                    rel="noopener noreferrer"
                    on:click={(e) => handleDownload(e, note.id, note.file_name || 'file')}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    下载文件
                  </a>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- 底部发送与上传区 -->
    <div class="drawer-footer">
      <div class="input-container">
        <textarea
          bind:value={textContent}
          on:keydown={handleTextKeyDown}
          placeholder="输入要传输的文字... (Ctrl+Enter 发送)"
          rows="3"
        ></textarea>
      </div>

      <div class="footer-bar">
        <div class="tools-left">
          <input
            type="file"
            bind:this={fileInput}
            on:change={handleFileInputChange}
            style="display: none;"
          />
          <button
            type="button"
            class="btn-tool"
            on:click={() => fileInput?.click()}
            title="选择文件或图片上传"
            disabled={uploading}
          >
            📎 文件
          </button>

          <select bind:value={selectedTtlDays} class="select-ttl" title="有效期限">
            <option value={1}>24小时</option>
            <option value={7}>7天(推荐)</option>
            <option value={30}>30天</option>
            <option value={0}>永久保存</option>
          </select>
        </div>

        <button
          type="button"
          class="btn-send"
          on:click={handleSendText}
          disabled={uploading || !textContent.trim()}
        >
          {uploading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  </div>

  <!-- 大图灯箱预览模态框 -->
  {#if lightboxImage}
    <div class="lightbox-overlay" on:click={() => transferStore.closeLightbox()} role="presentation">
      <div class="lightbox-content">
        <img src={lightboxImage} alt="高清预览" />
        <button type="button" class="lightbox-close" on:click={() => transferStore.closeLightbox()}>
          &times;
        </button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 23, 42, 0.4);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }

  .drawer-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 420px;
    max-width: 100vw;
    z-index: 101;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(16px);
    border-left: 1px solid rgba(148, 163, 184, 0.28);
    box-shadow: -8px 0 32px rgba(15, 23, 42, 0.16);
    display: flex;
    flex-direction: column;
    animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    color: #0f172a;
  }

  :global([data-theme='dark']) .drawer-panel {
    background: rgba(15, 23, 42, 0.94);
    border-left-color: rgba(148, 163, 184, 0.18);
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
    color: #f1f5f9;
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    z-index: 110;
    background: rgba(37, 99, 235, 0.15);
    backdrop-filter: blur(8px);
    border: 3px dashed #2563eb;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .drag-box {
    background: white;
    padding: 1.5rem 2rem;
    border-radius: 1rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #2563eb;
    font-weight: 600;
  }

  :global([data-theme='dark']) .drag-box {
    background: #1e293b;
    color: #60a5fa;
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.05rem;
    font-weight: 600;
    color: #1e293b;
  }

  :global([data-theme='dark']) .header-title {
    color: #f8fafc;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .btn-icon {
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #475569 !important;
    transition: background var(--transition-base), color var(--transition-base);
  }

  .btn-icon:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #0f172a !important;
  }

  :global([data-theme='dark']) .btn-icon {
    border-color: rgba(148, 163, 184, 0.25);
    color: #cbd5e1 !important;
  }

  :global([data-theme='dark']) .btn-icon:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f8fafc !important;
  }

  .close-btn {
    font-size: 1.3rem;
    line-height: 1;
  }

  .btn-text {
    background: transparent;
    border: none;
    font-size: 0.85rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-text.danger {
    color: #ef4444;
  }

  .btn-text.danger:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .drawer-feed {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .empty-state, .loading-state {
    margin: auto;
    text-align: center;
    padding: 2rem 1rem;
    color: #64748b;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .empty-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: #334155;
    margin-bottom: 0.35rem;
  }

  :global([data-theme='dark']) .empty-title {
    color: #cbd5e1;
  }

  .empty-hint {
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .note-card {
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 0.75rem;
    padding: 0.75rem;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
    transition: border-color var(--transition-base);
  }

  :global([data-theme='dark']) .note-card {
    background: rgba(30, 41, 59, 0.7);
    border-color: rgba(148, 163, 184, 0.16);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .note-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .note-expiration {
    margin-left: auto;
    background: rgba(148, 163, 184, 0.15);
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
  }

  .note-delete-btn {
    background: transparent;
    border: none;
    font-size: 1.1rem;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
    padding: 0 0.2rem;
  }

  .note-delete-btn:hover {
    color: #ef4444;
  }

  .text-content {
    font-size: 0.9rem;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
    color: #1e293b;
  }

  :global([data-theme='dark']) .text-content {
    color: #e2e8f0;
  }

  :global(.link-url) {
    color: #2563eb;
    text-decoration: underline;
  }

  :global([data-theme='dark'] .link-url) {
    color: #60a5fa;
  }

  .image-box {
    border-radius: 0.5rem;
    overflow: hidden;
    max-height: 220px;
    display: flex;
    background: rgba(0, 0, 0, 0.04);
  }

  .image-thumb-btn {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .image-thumb-btn img {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
  }

  .image-error-fallback {
    width: 100%;
    padding: 1.5rem 1rem;
    text-align: center;
    background: rgba(239, 68, 68, 0.06);
    color: #ef4444;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
  }

  :global([data-theme='dark']) .image-error-fallback {
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
  }

  .file-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    margin-top: 0.4rem;
    color: #64748b;
  }

  .file-card-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0;
  }

  .file-icon-box {
    font-size: 1.8rem;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .filename {
    font-size: 0.85rem;
    font-weight: 500;
    color: #1e293b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global([data-theme='dark']) .filename {
    color: #f1f5f9;
  }

  .filesize {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .card-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px dashed rgba(148, 163, 184, 0.2);
  }

  .btn-copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(37, 99, 235, 0.08);
    border: 1px solid rgba(37, 99, 235, 0.2);
    color: #2563eb;
    border-radius: 0.375rem;
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    text-decoration: none;
    font-weight: 500;
  }

  .btn-copy:hover {
    background: rgba(37, 99, 235, 0.16);
  }

  :global([data-theme='dark']) .btn-copy {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.3);
    color: #93c5fd;
  }

  .drawer-footer {
    padding: 0.85rem 1rem 1rem;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(255, 255, 255, 0.5);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  :global([data-theme='dark']) .drawer-footer {
    background: rgba(15, 23, 42, 0.5);
  }

  .input-container textarea {
    width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 0.5rem;
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    background: #ffffff !important;
    color: #0f172a !important;
    resize: none;
    outline: none;
    box-sizing: border-box;
    font-family: inherit;
    line-height: 1.5;
    transition: border-color var(--transition-base), box-shadow var(--transition-base);
  }

  .input-container textarea::placeholder {
    color: #94a3b8 !important;
    opacity: 1;
  }

  :global([data-theme='dark']) .input-container textarea {
    background: #1e293b !important;
    color: #f8fafc !important;
    border-color: rgba(148, 163, 184, 0.3);
  }

  :global([data-theme='dark']) .input-container textarea::placeholder {
    color: #64748b !important;
  }

  .input-container textarea:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }

  :global([data-theme='dark']) .input-container textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .footer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .tools-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .btn-tool {
    border: 1px solid rgba(148, 163, 184, 0.4);
    background: #ffffff !important;
    padding: 0.35rem 0.65rem;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    cursor: pointer;
    color: #0f172a !important;
    font-weight: 500;
    transition: background var(--transition-base), color var(--transition-base), border-color var(--transition-base);
  }

  .btn-tool:hover:not(:disabled) {
    background: #f1f5f9 !important;
    color: #0f172a !important;
  }

  :global([data-theme='dark']) .btn-tool {
    background: #1e293b !important;
    border-color: rgba(148, 163, 184, 0.3);
    color: #f8fafc !important;
  }

  :global([data-theme='dark']) .btn-tool:hover:not(:disabled) {
    background: #334155 !important;
    color: #ffffff !important;
  }

  .select-ttl {
    border: 1px solid rgba(148, 163, 184, 0.4);
    background: #ffffff !important;
    padding: 0.35rem 0.6rem;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    color: #0f172a !important;
    font-weight: 500;
    outline: none;
    transition: border-color var(--transition-base);
  }

  .select-ttl:focus {
    border-color: #2563eb;
  }

  :global([data-theme='dark']) .select-ttl {
    background: #1e293b !important;
    border-color: rgba(148, 163, 184, 0.3);
    color: #f8fafc !important;
  }

  .select-ttl option {
    background: #ffffff;
    color: #0f172a;
  }

  :global([data-theme='dark']) .select-ttl option {
    background: #1e293b;
    color: #f8fafc;
  }

  .btn-send {
    background: #2563eb;
    color: white;
    border: none;
    padding: 0.35rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-base);
  }

  .btn-send:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* 灯箱预览 */
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .lightbox-content {
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
  }

  .lightbox-content img {
    max-width: 90vw;
    max-height: 85vh;
    object-fit: contain;
    border-radius: 0.5rem;
  }

  .lightbox-close {
    position: absolute;
    top: -2.5rem;
    right: 0;
    background: transparent;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @media (max-width: 480px) {
    .drawer-panel {
      width: 100vw;
    }
  }
</style>
