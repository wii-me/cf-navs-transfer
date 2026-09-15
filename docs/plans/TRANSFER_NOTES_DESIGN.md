# 跨设备便笺与文件传输助手设计方案 (Transfer Notes Spec)

## 一、 背景与目标

CF-Navs 作为个人/团队常驻浏览器主页的导航系统，具备多设备经常访问的天然优势。本功能旨在让管理员在登录后，能够将导航站作为轻量级的**跨设备中转站**，实现：
1. 电脑与手机之间秒级互传文字、剪贴板、代码片段。
2. 电脑截图直接 `Ctrl + V` 粘贴发送给手机。
3. 跨设备传输高清原图与小文件（PDF、压缩包、安装包等）。
4. 数据按需保留或自动过期销毁，保护免费存储配额。

---

## 二、 系统架构与存储设计

系统基于 Cloudflare 边缘架构，结合 D1 与 R2 优势：

### 1. 资源绑定 (`wrangler.toml` 与 `worker/types.ts`)
* **D1 数据库绑定**：`DB`（沿用既有 D1 实例，用于记录文本与文件元数据）
* **R2 存储桶绑定**：`STORAGE`（新增 R2 绑定，用于存储上传的文件与原图，免费额度 10GB）

```toml
# wrangler.toml 新增绑定
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "cf-navs-storage"
```

### 2. 数据库结构 (`schema.sql`)
在 SQLite (D1) 中新增 `transfer_notes` 表：

```sql
CREATE TABLE IF NOT EXISTS transfer_notes (
    id TEXT PRIMARY KEY,                 -- 记录唯一 UUID (如 n_1726412345_xxxx)
    type TEXT NOT NULL,                  -- 内容类型: 'text' | 'image' | 'file'
    content TEXT,                        -- 文本内容 / 备注
    file_key TEXT,                       -- R2 对象 Key (如 transfers/2026-09/uuid.png)
    file_name TEXT,                      -- 上传原始文件名 (如 "screenshot.png")
    file_size INTEGER,                   -- 文件大小（字节 Byte）
    mime_type TEXT,                      -- MIME 类型 (如 "image/png", "application/pdf")
    created_at INTEGER NOT NULL,         -- 创建时间戳（毫秒）
    expires_at INTEGER                   -- 过期时间戳（毫秒，NULL 表示永久保留）
);

CREATE INDEX IF NOT EXISTS idx_transfer_notes_created_at ON transfer_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_notes_expires_at ON transfer_notes(expires_at);
```

### 3. 数据生命周期与惰性清理
* 发送时可选有效期：`24小时`、`7天`（默认）、`30天`、`永久`。
* **双重自动清理机制**：
  1. **惰性轮询**：每次客户端拉取列表接口或上传新文件时，服务端异步触发一次批量清理（查找 `expires_at IS NOT NULL AND expires_at < ?`，从 R2 删除对应 `file_key`，再从 D1 删除行）。
  2. **下载拦截**：若文件未被及时清理，但请求时已经过期，端点直接响应 404 并触发异步清除。

---

## 三、 后端 API 与路由设计 (`worker/routes/transfers.ts`)

所有传输路由统一置于 `/api/transfers` 路径下，并由 `authRequired` 中间件保护（仅限登录管理员）。

### 1. 接口规范

| 路径 | 方法 | 请求内容 | 响应内容 | 说明 |
|---|---|---|---|---|
| `/api/transfers` | `GET` | `?limit=50&cursor=...` | `{ items: TransferNote[], hasMore: boolean }` | 获取流式记录列表（按创建时间倒序），并惰性清理过期项 |
| `/api/transfers/text` | `POST` | `{ content: string, ttlDays?: number }` | `{ success: true, item: TransferNote }` | 发送一段文本 |
| `/api/transfers/file` | `POST` | `multipart/form-data`（包含 `file` 与 `ttlDays`） | `{ success: true, item: TransferNote }` | 上传文件/图片，写入 R2 与 D1 |
| `/api/transfers/file/:id` | `GET` | 路径 ID | 文件二进制流 | 预览或下载指定文件，支持 Content-Disposition / MIME |
| `/api/transfers/:id` | `DELETE` | 路径 ID | `{ success: true }` | 删除单条记录（若有 R2 资源同步从 R2 移除） |
| `/api/transfers/clear` | `POST` | 无 | `{ success: true, deletedCount: number }` | 清空所有历史传输记录与文件 |

### 2. 安全与性能契约
* 单文件最大上传限制：**50 MB**（超出直接在客户端和 Worker 端拦截）。
* 防未授权访问：下载文件时校验用户会话，禁止通过暴力猜解 URL 访问他人中转的敏感文件。
* 错误容灾：若 R2 存储桶未正确配置，接口返回明确的错误提示（如 `R2_STORAGE_NOT_CONFIGURED`），文本便笺依然可降级正常使用。

---

## 四、 前端交互与组件设计 (`src/lib/components/TransferDrawer.svelte`)

### 1. 入口与触发方式
* **导航栏按钮**：管理员登录成功后，在顶部操作区域（管理/退出登录旁）展示图标按钮（纸飞机 / 便笺图标）。
* **全局快捷键**：支持快捷键快速打开/收起（`Ctrl + J` 或 `Alt + T`，按 `ESC` 键或点击遮罩关闭）。

### 2. 界面与交互行为
* **抽屉侧栏 (Drawer)**：
  * 桌面端从右侧滑出（宽约 420px），保持毛玻璃质感，与整体主题样式协调。
  * 移动端自适应全屏或底栏升起，兼顾单手操作。
* **消息流区 (Message Feed)**：
  * 顶部工具栏：标题、[一键清空]、[手动刷新]、[关闭]。
  * 消息列表按时间倒叙滚动：
    * **文本卡片**：自动识别超链接可点击；醒目的“一键复制”按钮与复制成功 Toast；创建时间与剩余有效期徽标。
    * **图片卡片**：高清自适应缩略图；点击进入大图灯箱预览（支持滚轮/手势放大）；下载按钮与复制图片操作。
    * **文件卡片**：区分文件类型图标，显示文件名与格式化大小（如 `3.4 MB`）；一键下载按钮。
* **底部发送区 (Send Area)**：
  * 多行自适应输入框，支持 `Ctrl + Enter` 快捷发送。
  * 文件选择按钮（📎）、有效期下拉选择器（默认 7 天）。
  * **全局截图粘贴监听**：抽屉激活状态下，直接按 `Ctrl + V` 粘贴系统截图，自动提取并上传，免去保存到本地再选择的繁琐步骤。
  * **拖拽上传区**：直接将桌面文件拖拽进抽屉任意区域即可完成上传。

---

## 五、 验证与测试方案

1. **功能验证**：
   * 纯文本发送、跨设备复制功能验证。
   * 剪贴板直接粘贴（`Ctrl + V`）截图并上传验证。
   * 普通文件（文档、压缩包）拖拽上传与下载验证。
   * 过期时间到期后的自动清理与删除联动验证。
2. **构建与类型验证**：
   * `npm run type-check` 验证 Svelte 5 与 TypeScript 类型无报错。
   * `npm test` 确保既有书签、分类和管理接口测试不受影响。
   * `npm run build` 确保前端与 Worker 构建成功。
