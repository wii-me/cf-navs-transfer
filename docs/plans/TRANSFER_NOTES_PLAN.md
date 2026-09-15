# 跨设备便笺与文件传输助手实现计划 (Transfer Notes Implementation Plan)

**Goal:** 为 CF-Navs 构建已登录状态下的跨设备便笺与文件/图片传输助手，支持流式中转文本、Ctrl+V 粘贴截图、拖拽上传文件、自动过期清理与右侧抽屉式交互。

**Architecture:** 后端利用 Cloudflare D1 存储便笺元数据与纯文本，利用 Cloudflare R2 对象存储托管图片与文件流，通过 Hono 路由与 `authRequired` 鉴权保护 API；前端使用 Svelte 5 构建响应式抽屉组件 `TransferDrawer`，集成剪贴板监听、拖拽上传、一键复制与大图预览。

**Tech Stack:** Svelte 5, TypeScript, Vite 7, Hono, Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare R2, Vitest

**Spec:** [`docs/plans/TRANSFER_NOTES_DESIGN.md`](TRANSFER_NOTES_DESIGN.md)

## Global Constraints

- 前后端共享类型严格唯一定义在 `shared/types.ts`，禁止前后端各自重复定义。
- 所有 `/api/transfers` 路由必须受 `authRequired` 中间件保护，未登录返回 401。
- 单文件上传最大体积限制为 50MB。
- 数据库表操作遵循既有 `schema.sql` 语法，兼容 SQLite/D1。
- 保证既有 118 个测试文件、872 个测试全部通过，不引入任何 regression。

---

### Task 1: 共享类型、数据库结构与 R2 绑定配置

**Files:**
- Modify: `shared/types.ts`
- Modify: `schema.sql`
- Modify: `worker/types.ts`
- Modify: `wrangler.toml`
- Test: `tests/unit/transferSchema.test.ts`

**Interfaces:**
- Produces:
  - `TransferType`: `'text' | 'image' | 'file'`
  - `TransferNote`: `{ id: string; type: TransferType; content: string | null; file_key: string | null; file_name: string | null; file_size: number | null; mime_type: string | null; created_at: number; expires_at: number | null }`
  - `TransferTextReq`: `{ content: string; ttlDays?: number }`
  - `TransferNotesResp`: `{ items: TransferNote[]; hasMore: boolean }`
  - `TransferClearResp`: `{ success: boolean; deletedCount: number }`
  - `Env.STORAGE?: R2Bucket`

- [ ] **Step 1: 编写数据结构与类型定义验证测试**

创建 `tests/unit/transferSchema.test.ts`：
```typescript
import { describe, it, expect } from 'vitest'
import type { TransferNote, TransferType, TransferTextReq } from '../../shared/types'

describe('Transfer Note Types & Schema', () => {
  it('validates TransferNote data structure contract', () => {
    const note: TransferNote = {
      id: 'tn_123456',
      type: 'text',
      content: 'Hello cross-device!',
      file_key: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      created_at: Date.now(),
      expires_at: Date.now() + 86400000,
    }
    expect(note.id).toBe('tn_123456')
    expect(note.type).toBe('text')
    expect(note.content).toBe('Hello cross-device!')
    expect(note.expires_at).toBeGreaterThan(note.created_at)
  })

  it('supports image and file transfer types', () => {
    const types: TransferType[] = ['text', 'image', 'file']
    expect(types).toHaveLength(3)

    const fileNote: TransferNote = {
      id: 'tn_img_1',
      type: 'image',
      content: null,
      file_key: 'transfers/2026-09/screenshot.png',
      file_name: 'screenshot.png',
      file_size: 102400,
      mime_type: 'image/png',
      created_at: 1726412345000,
      expires_at: null,
    }
    expect(fileNote.type).toBe('image')
    expect(fileNote.file_size).toBe(102400)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/transferSchema.test.ts -- --run`
预期：FAIL (找不到 `TransferNote` / `TransferType` 导出)

- [ ] **Step 3: 更新 shared/types.ts、schema.sql、worker/types.ts 与 wrangler.toml**

在 `shared/types.ts` 追加：
```typescript
// ========== 便笺与文件传输助手 ==========

export type TransferType = 'text' | 'image' | 'file'

export interface TransferNote {
  id: string
  type: TransferType
  content: string | null
  file_key: string | null
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  created_at: number
  expires_at: number | null
}

export interface TransferTextReq {
  content: string
  ttlDays?: number
}

export interface TransferNotesResp {
  items: TransferNote[]
  hasMore: boolean
}

export interface TransferClearResp {
  success: boolean
  deletedCount: number
}
```

在 `schema.sql` 追加：
```sql
-- 跨设备传输与便笺记录表
CREATE TABLE IF NOT EXISTS transfer_notes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT,
    file_key TEXT,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_transfer_notes_created_at ON transfer_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_notes_expires_at ON transfer_notes(expires_at);
```

在 `worker/types.ts` 中 `Env` 接口追加：
```typescript
STORAGE?: R2Bucket
```

在 `wrangler.toml` 中追加可选 R2 绑定说明：
```toml
# 跨设备文件与图片传输 R2 存储桶绑定（可选）
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "cf-navs-storage"
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/transferSchema.test.ts -- --run`
预期：PASS

- [ ] **Step 5: 提交更改**

```bash
git add shared/types.ts schema.sql worker/types.ts wrangler.toml tests/unit/transferSchema.test.ts
git commit -m "feat(transfer): add shared types, D1 schema and R2 binding definition"
```

---

### Task 2: 后端传输 API 路由与过期清理逻辑

**Files:**
- Create: `worker/routes/transfers.ts`
- Modify: `worker/index.ts`
- Test: `tests/unit/transferRoutes.test.ts`

**Interfaces:**
- Consumes: `TransferNote`, `TransferTextReq`, `Env.STORAGE`, `Env.DB`
- Produces: `transfersRoutes: Hono<HonoEnv>`

- [ ] **Step 1: 编写 Worker 传输路由单元测试**

创建 `tests/unit/transferRoutes.test.ts`：
覆盖：
1. 文本发送（`POST /api/transfers/text`）以及 TTL 计算。
2. 文本列表获取（`GET /api/transfers`）以及自动清理过期记录逻辑。
3. 单条删除与清空（`DELETE /api/transfers/:id`、`POST /api/transfers/clear`）。
4. 文件上传校验（`POST /api/transfers/file`：缺少文件或超出大小返回错误）。
5. 文件预览与下载（`GET /api/transfers/file/:id`：Content-Type、Content-Disposition 设置）。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/transferRoutes.test.ts -- --run`
预期：FAIL (文件或路由未定义)

- [ ] **Step 3: 实现 worker/routes/transfers.ts 并在 worker/index.ts 挂载**

核心业务逻辑：
1. `GET /api/transfers`:
   * 查询 `SELECT * FROM transfer_notes ORDER BY created_at DESC LIMIT ? OFFSET ?`
   * 异步清理 `DELETE FROM transfer_notes WHERE expires_at IS NOT NULL AND expires_at < ?`
   * 若有清理出来的带有 `file_key` 的行，异步调用 `STORAGE.delete(keys)`
2. `POST /api/transfers/text`:
   * 校验 `content` 不能为空且小于 100,000 字符。
   * 生成 UUID，计算 `expires_at = ttlDays ? Date.now() + ttlDays * 86400000 : null`。
   * 写入 D1 并返回包装好的 `TransferNote`。
3. `POST /api/transfers/file`:
   * 检查 `c.env.STORAGE` 是否绑定，未绑定返回友好提示错误。
   * 解析 `multipart/form-data`，获取 `file` 与 `ttlDays`。
   * 检查 `file.size <= 50 * 1024 * 1024`。
   * 生成 fileKey: `transfers/${yearMonth}/${id}-${sanitizedFilename}`。
   * 调用 `c.env.STORAGE.put(fileKey, file.stream(), { httpMetadata: { contentType: file.type } })`。
   * 判断 `type = file.type.startsWith('image/') ? 'image' : 'file'`。
   * 写入 D1 并返回。
4. `GET /api/transfers/file/:id`:
   * 查找记录，校验是否过期（过期返回 404）。
   * 从 R2 获取对象并流式返回，设置 `Content-Type: note.mime_type`，`Content-Disposition: inline/attachment`。
5. `DELETE /api/transfers/:id` 和 `POST /api/transfers/clear`。

在 `worker/index.ts` 注册：
```typescript
app.use('/api/transfers', authRequired)
app.use('/api/transfers/*', authRequired)
app.route('/api/transfers', transfersRoutes)
```

- [ ] **Step 4: 运行测试验证全部通过**

运行：`npm test tests/unit/transferRoutes.test.ts -- --run`
预期：PASS

- [ ] **Step 5: 提交更改**

```bash
git add worker/routes/transfers.ts worker/index.ts tests/unit/transferRoutes.test.ts
git commit -m "feat(transfer): implement worker API routes and lazy expiration cleanup"
```

---

### Task 3: 前端数据客户端与状态管理 (transferStore)

**Files:**
- Create: `src/lib/services/transferService.ts`
- Create: `src/lib/stores/transferStore.ts`
- Test: `tests/unit/transferStore.test.ts`

**Interfaces:**
- Consumes: `TransferNote`, `TransferTextReq`, `TransferNotesResp`, `transferService`
- Produces: `transferStore` 响应式 Svelte Store，提供：
  - `notes: TransferNote[]`
  - `loading: boolean`
  - `uploading: boolean`
  - `drawerOpen: boolean`
  - `activeLightboxImage: string | null`
  - `fetchNotes(): Promise<void>`
  - `sendText(content: string, ttlDays?: number): Promise<void>`
  - `uploadFile(file: File, ttlDays?: number): Promise<void>`
  - `deleteNote(id: string): Promise<void>`
  - `clearAll(): Promise<void>`
  - `openDrawer(): void`
  - `closeDrawer(): void`
  - `toggleDrawer(): void`

- [ ] **Step 1: 编写 transferStore 单元测试**

创建 `tests/unit/transferStore.test.ts`：
验证 store 的初始状态、`fetchNotes` 列表填充、`sendText` 乐观更新或新增插入、`deleteNote` 过滤、`toggleDrawer` 开关状态。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/transferStore.test.ts -- --run`
预期：FAIL (找不到模块)

- [ ] **Step 3: 实现 transferService.ts 与 transferStore.ts**

`src/lib/services/transferService.ts` 封装调用 fetch API。
`src/lib/stores/transferStore.ts` 封装响应式数据流与状态控制。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/transferStore.test.ts -- --run`
预期：PASS

- [ ] **Step 5: 提交更改**

```bash
git add src/lib/services/transferService.ts src/lib/stores/transferStore.ts tests/unit/transferStore.test.ts
git commit -m "feat(transfer): add transfer service and svelte store"
```

---

### Task 4: 前端抽屉组件 (TransferDrawer.svelte) 与交互

**Files:**
- Create: `src/lib/components/TransferDrawer.svelte`
- Test: `tests/unit/transferDrawer.test.ts`

**Interfaces:**
- Consumes: `transferStore`, `toastStore`
- Produces: `<TransferDrawer />`

- [ ] **Step 1: 编写 TransferDrawer 组件渲染与交互测试**

创建 `tests/unit/transferDrawer.test.ts`：
验证：
1. 抽屉打开与关闭渲染逻辑（class 绑定、aria-modal）。
2. 文本卡片渲染与“一键复制”按钮调用剪贴板。
3. 图片卡片渲染与大图预览触发。
4. 快捷键与粘贴事件处理机制。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/transferDrawer.test.ts -- --run`
预期：FAIL (组件不存在)

- [ ] **Step 3: 实现 TransferDrawer.svelte**

功能清单：
1. **抽屉结构**：遮罩层（backdrop blur）、滑动主体面板、顶部操作栏（标题、清空全部按钮、刷新按钮、关闭按钮）。
2. **列表卡片流**：
   * 自动换行、URL 链接可点击、Markdown 换行支持。
   * “一键复制”按钮与复制成功后的 Toast 提示。
   * 图片缩略图展示，点击放大全屏灯箱。
   * 文件类型图标与格式化大小显示（`formatFileSize`）。
   * 到期时间友好提示（如“7天后过期”、“永久”）。
3. **底部发送区**：
   * 自适应文本框，支持 `Ctrl + Enter` 直接发送。
   * 📎 附件选择按钮，有效期下拉框（24小时 / 7天 / 30天 / 永久）。
   * 发送中 Loading 状态显示。
4. **快捷交互支持**：
   * 全局/窗口 `paste` 监听：当抽屉打开时，用户截图按 `Ctrl + V`，自动提取 `event.clipboardData.files[0]` 并上传。
   * 拖拽上传支持（`dragover`, `drop` 事件）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/transferDrawer.test.ts -- --run`
预期：PASS

- [ ] **Step 5: 提交更改**

```bash
git add src/lib/components/TransferDrawer.svelte tests/unit/transferDrawer.test.ts
git commit -m "feat(transfer): implement TransferDrawer UI component with paste and drag upload"
```

---

### Task 5: 导航入口集成与全局快捷键绑定

**Files:**
- Modify: `src/components/HomeFloatingActions.svelte`
- Modify: `src/components/admin/AdminPageHeader.svelte`
- Modify: `src/App.svelte`
- Test: `tests/unit/transferIntegration.test.ts`

**Interfaces:**
- Consumes: `transferStore`, `TransferDrawer.svelte`
- Produces: 全局快捷唤出入口

- [ ] **Step 1: 编写导航栏入口与快捷键集成测试**

创建 `tests/unit/transferIntegration.test.ts`：
验证：
1. 未登录时不显示传输便笺按钮；登录后在悬浮按钮组中正确展示便笺按钮。
2. 点击按钮触发 `transferStore.toggleDrawer()`。
3. 按下 `Ctrl + J` 或 `Alt + T` 触发抽屉切换。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/transferIntegration.test.ts -- --run`
预期：FAIL

- [ ] **Step 3: 修改 HomeFloatingActions.svelte、AdminPageHeader.svelte 与 App.svelte**

1. 在 `HomeFloatingActions.svelte` 的已登录区域增加便笺图标按钮：
   ```svelte
   <button
     type="button"
     class="icon-button transfer-button"
     data-testid="home-transfer-button"
     on:click={handleOpenTransfer}
     title="便笺传输助手 (Ctrl+J)"
     aria-label="便笺传输助手"
   >
     <svg viewBox="0 0 24 24" aria-hidden="true">
       <path d="m22 2-7 20-4-9-9-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
       <path d="M22 2 11 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
     </svg>
   </button>
   ```
2. 在 `AdminPageHeader.svelte` 增加相同入口。
3. 在 `App.svelte` 引入 `<TransferDrawer />`，并挂载全局 `keydown` 监听（`Ctrl+J` / `Alt+T`）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/transferIntegration.test.ts -- --run`
预期：PASS

- [ ] **Step 5: 提交更改**

```bash
git add src/components/HomeFloatingActions.svelte src/components/admin/AdminPageHeader.svelte src/App.svelte tests/unit/transferIntegration.test.ts
git commit -m "feat(transfer): integrate navbar buttons and global keyboard shortcuts"
```

---

### Task 6: 完整构建、全量回归与类型检查

**Files:**
- None (全面审计验证)

- [ ] **Step 1: 运行全量单元测试**

运行：`npm test`
预期：所有现有 118 个测试文件以及新增的 5 个测试文件（共 123 个测试套件）全部通过（0 failures）。

- [ ] **Step 2: 运行类型检查**

运行：`npm run type-check`
预期：无任何 TypeScript 或 Svelte 类型错误。

- [ ] **Step 3: 运行生产环境打包**

运行：`npm run build`
预期：Vite 构建前端资源成功，生成生产打包文件。

- [ ] **Step 4: 提交所有验证与最终版本**

```bash
git status
git commit -am "chore(transfer): complete verification and test coverage"
```
