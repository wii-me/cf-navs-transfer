<div align="center">
  <img src="public/icon.png" alt="CF-Navs Transfer 项目图标" width="110" height="110">
  <h1>CF-Navs Transfer</h1>
  <p><strong>云原生极速起始页 · 跨设备便笺与 50MB 大文件传输中转站</strong></p>
  <p>基于 Cloudflare Workers 边缘计算平台，集成 D1、KV 与 R2 对象存储，无需自建服务器，零运维成本。<br>
  集常用网站导航、两级书签收纳、私密收藏管理与跨端剪贴板即贴即传、图片灯箱预览、文件安全下载于一体。</p>

  <p>
    <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
    <a href="https://developers.cloudflare.com/d1/"><img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1"></a>
    <a href="https://developers.cloudflare.com/kv/"><img src="https://img.shields.io/badge/Cloudflare-KV-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare KV"></a>
    <a href="https://developers.cloudflare.com/r2/"><img src="https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare R2"></a>
    <a href="https://svelte.dev/"><img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2563EB" alt="MIT License"></a>
  </p>

  <p>
    <a href="#-核心特性">核心特性</a> ·
    <a href="#-跨设备便笺与文件传输助手-transfer-notes">便笺与传输</a> ·
    <a href="#️-界面展示">界面展示</a> ·
    <a href="#️-快捷键指南">快捷键指南</a> ·
    <a href="#-快速部署">快速部署</a> ·
    <a href="#️-本地开发">本地开发</a> ·
    <a href="#-常见问题-faq">常见问题</a> ·
    <a href="docs/README.md">详细文档</a>
  </p>

  <p>
    <a href="https://github.com/wii-me/cf-navs-transfer">
      <img src="https://img.shields.io/github/stars/wii-me/cf-navs-transfer?style=social" alt="GitHub Stars">
    </a>
    <a href="https://github.com/wii-me/cf-navs-transfer/fork">
      <img src="https://img.shields.io/github/forks/wii-me/cf-navs-transfer?style=social" alt="GitHub Forks">
    </a>
  </p>
</div>

---

## ✨ 核心特性

CF-Navs Transfer 不仅是一个颜值出众、功能强大的个人专属起始页，更是你在电脑、手机与平板之间无缝流转文本与文件的**私有边缘中转站**。

### 🚀 1. 跨设备便笺与文件传输助手（全新升级）
- **剪贴板即贴即传 (`Ctrl+V`)**：在传输面板按下 `Ctrl+V`（或手机粘贴），自动识别文字或将截屏图片直接上传发送，省去手动存图流程。
- **R2 50MB 大文件传输**：原生深度集成 Cloudflare R2 对象存储，支持文档、压缩包、安装包等全格式，单文件上限 **50 MB**，零消耗 D1 数据库配额。
- **图片全屏灯箱预览**：图片附件自动生成高清缩略图，点击即刻进入全屏灯箱无损查看与平滑缩放，支持一键安全下载与重命名。
- **多档 TTL 自动销毁策略**：支持 **1小时**、**1天**、**7天** 及 **永久** 保留，到期由边缘调度机制安全清理，避免闲置占用存储空间。
- **全局快捷唤起 (`Ctrl+J`)**：在站内任意位置按下 `Ctrl+J` / `Cmd+J`，随时呼出半浮动中转面板，即传即走，不打断当前工作流。

### 🧭 2. 现代化极速起始页与书签管理
- **两级分类层级**：清晰的分组与子分类架构，支持一键折叠、顶部导航分行与自适应左侧栏。
- **毫秒级全站检索**：支持对书签标题、URL、描述以及所属分类完整路径进行模糊搜索，支持快捷键直接唤起搜索框。
- **跨分类拖拽与批量整理**：支持桌面端全能拖拽排序与移动端无感穿梭；后台支持跨路径多选批量迁移。
- **私密书签与私密分类**：一键设置“仅登录可见”，访客访问时边缘接口自动抹除私密数据，隐私安全无懈可击。
- **22 款内置精美主题**：提供纯色护眼、现代磨砂毛玻璃以及沉浸式暗黑风格，支持自定义强调色与字体大小，桌面卡片宽度最低可设为 40px。
- **浏览器扩展单向同步**：内置 Chrome/Edge 扩展，浏览器新增书签自动同步至指定分类，不覆盖原有数据。

### 🛡️ 3. 银行级边缘安全与性能架构
- **全边缘无服务器架构**：运行于 Cloudflare 遍布全球的边缘节点，首屏毫秒级直出。
- **严苛的安全策略**：
  - 会话采用 PBKDF2 强哈希算法与 JWT 鉴权，支持 KV 撤销黑名单与防暴力破解频控。
  - 强制全站 `X-Frame-Options: DENY` 点击劫持防护与 `X-Content-Type-Options: nosniff`。
  - 文件下载采用沙箱化 CSP 与 Attachment 强制隔离下载，彻底切断存储型 XSS 风险。
  - 服务端代理抓取具备 SSRF 内网防护与图标缓存隔离。

---

## 📦 跨设备便笺与文件传输助手 (Transfer Notes)

<div align="center">
  <img src="docs/screenshots/cf-navs-transfer-assistant.png" alt="CF-Navs Transfer 便笺传输助手界面" width="380" style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
</div>

便笺与传输助手是专为多设备工作者打造的私有边缘中转面板：

| 功能维度 | 特性细节 |
|---|---|
| **输入与传输** | 支持富文本/纯文本随手记、代码段、多行文本；支持剪贴板图片 `Ctrl+V` 直接贴图发送 |
| **存储底座** | Cloudflare R2 对象存储，免受 VPS 磁盘容量与带宽瓶颈限制，支持单文件高达 **50 MB** |
| **文件类型** | 全格式兼容，包括 `.png`, `.jpg`, `.pdf`, `.zip`, `.dmg`, `.apk`, `.xlsx`, `.mp4` 等 |
| **浏览与查看** | 图像附件自动展示高清缩略，支持灯箱原图查看；非图片文件展示原生类型图标与文件大小 |
| **生命周期** | 支持 1小时、1天、7天及永久 4 种保留策略，到期自动回收空间，支持随时手动彻底销毁 |
| **呼出方式** | 键盘快捷键 `Ctrl+J` / `Cmd+J`，或点击导航栏右上角传输图标随时呼出/隐藏 |

---

## 🖼️ 界面展示

### 1. 跨设备便笺与文件传输助手（实机效果）
<p align="center">
  <img src="docs/screenshots/cf-navs-transfer-assistant.png" alt="CF-Navs Transfer 便笺传输助手：文件下载、图片缩略与文本随手记" width="360">
  <br>
  <em>手机与桌面端均完美适配，右侧滑入/浮动呼出，支持多文件直接下载与大图预览</em>
</p>

### 2. 桌面端主题风格（护眼纯色 vs 现代毛玻璃）
<table>
  <tr>
    <td align="center" width="50%">
      <strong>亮色模式（护眼 / 毛玻璃对角线对比）</strong><br><br>
      <img src="docs/screenshots/cf-navs-light.webp" alt="CF-Navs 亮色首页：护眼与毛玻璃对角线对比">
    </td>
    <td align="center" width="50%">
      <strong>暗色模式（护眼 / 毛玻璃对角线对比）</strong><br><br>
      <img src="docs/screenshots/cf-navs-dark.webp" alt="CF-Navs 暗色首页：护眼与毛玻璃对角线对比">
    </td>
  </tr>
</table>

### 3. 移动端竖屏自适应
<table>
  <tr>
    <td align="center" width="50%">
      <strong>移动端 · 亮色</strong><br><br>
      <img src="docs/screenshots/cf-navs-light-mobile.webp" alt="CF-Navs 移动端亮色首页" width="280">
    </td>
    <td align="center" width="50%">
      <strong>移动端 · 暗色</strong><br><br>
      <img src="docs/screenshots/cf-navs-dark-mobile.webp" alt="CF-Navs 移动端暗色首页" width="280">
    </td>
  </tr>
</table>

### 4. 强大的后台配置与主题定制
<p align="center">
  <img src="docs/screenshots/cf-navs-admin-setting.webp" alt="CF-Navs 主题与站点设置面板" width="800">
  <br>
  <em>提供 22 款预设主题调色盘、卡片尺寸调节、自定 CSS/JS 注入与隔离预览</em>
</p>

---

## ⌨️ 快捷键指南

| 快捷键 | 作用域 | 功能说明 |
|---|---|---|
| <kbd>Ctrl</kbd> + <kbd>J</kbd> / <kbd>Cmd</kbd> + <kbd>J</kbd> | 全局 | 随时呼出或收起**便笺与文件传输助手**窗口 |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> / <kbd>Cmd</kbd> + <kbd>V</kbd> | 传输助手面板 | 直接粘贴剪贴板文本，或将剪贴板中的截屏图片作为附件直接上传 |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd> | 传输助手输入框 | 快速提交并发送当前便笺与附件 |
| <kbd>Esc</kbd> | 全局 | 关闭当前打开的大图灯箱预览、设置弹窗或便笺传输浮窗 |
| <kbd>/</kbd> | 导航首页 | 快速聚焦站内搜索输入框，开始全站检索 |

---

## 🚀 快速部署

CF-Navs Transfer 完全基于 Cloudflare 原生 Serverless 生态构建，**无需自备服务器、无需固定公网 IP、无需备案**。

### 📋 所需 Cloudflare 资源清单

| 资源类别 | 绑定变量名 (Binding) | 默认命名建议 | 用途说明 |
|---|---|---|---|
| **Cloudflare D1** | `DB` | `cf-navs-db` | 存储分类、书签数据、站点配置以及便笺传输元数据 |
| **Cloudflare KV** | `SESSION` | `cf-navs-session` | 存储管理员登录态、会话撤销黑名单、API 频控防爆破记录 |
| **Cloudflare R2** | `STORAGE` | `cf-navs-storage` | 存储传输助手上传的各类文件、图片与附件对象 |
| **Secret 密钥** | `SETUP_TOKEN` | 自定义高强度字符串 | 仅用于首次初始化 `/install` 创建管理员账号时的身份凭证 |

---

### 方式一：Cloudflare 控制台 0 代码一键部署（推荐）

适合希望全程在浏览器完成配置、不想在本地安装环境的用户：

#### 步骤 1：准备仓库与关联构建
1. 点击右上角 **[Fork 本仓库](https://github.com/wii-me/cf-navs-transfer/fork)** 到你自己的 GitHub 账号下。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，依次点击 **Compute (Workers & Pages)** → **Create** → **Pages**（或 **Workers**）中的 **Import a repository**。
3. 授权并选中你刚才 Fork 的 `cf-navs-transfer` 仓库。
4. 构建配置如下：
   - **生产分支**：`main`
   - **Build command**：`npm run build`
   - **Deploy command**：`npx wrangler deploy`
   - **环境变量**：添加 `NODE_VERSION` = `24`

#### 步骤 2：检查并绑定 D1、KV 与 R2 资源
正常部署后，系统会自动根据 `wrangler.toml` 识别配置。进入 Worker 详情页的 **Settings (设置)** → **Bindings (绑定)**：
- **D1 数据库**：确认名为 `DB` 的绑定指向数据库 `cf-navs-db`（若未自动创建，点击添加并新建）。
- **KV 命名空间**：确认名为 `SESSION` 的绑定指向命名空间 `cf-navs-session`。
- **R2 存储桶**：确认名为 `STORAGE` 的绑定指向存储桶 `cf-navs-storage`（若未自动绑定，在 R2 界面新建一个存储桶并在绑定中添加 `STORAGE`）。

#### 步骤 3：配置初始化 Secret
在 Worker 的 **Settings (设置)** → **Variables and Secrets (变量与机密)** 中：
- 点击 **Add** 添加密钥，类型选择 **Secret (加密)**。
- 变量名为 `SETUP_TOKEN`，变量值为一段你自己定义的随机强密码（如 `MyStrongToken2026!`）。
- 保存后，进入 **Deployments** 页面对最新的一次部署点击 **Retry deployment (重新部署)**，使密钥注入生效。

#### 步骤 4：初始化数据库表结构与管理员账号
> [!IMPORTANT]
> 首次运行前必须初始化数据库表结构！
> 1. 打开 Cloudflare 控制台的 **Storage & Databases** → **D1 SQL Database** → 点击进入 `cf-navs-db` 数据库。
> 2. 点击进入 **Console** 标签页，将项目中的 [`schema.sql`](schema.sql) 文件内容完整复制并粘贴进去，点击 **Execute** 执行。
> 3. 打开部署好的 Workers 域名并在末尾追加 `/install`（例如 `https://your-nav.workers.dev/install`）。
> 4. 输入刚才设定的 `SETUP_TOKEN`，并设置管理员账号与密码即可完成初始化！

---

### 方式二：Wrangler CLI 极速部署（开发者推荐）

只需一行脚本与本地 CLI，3 分钟即可完成全自动化部署与数据库建表：

#### 前置要求
- 安装 **Node.js 22.12+** 或 **Node.js 24 LTS**。
- 本地配置好 Git 与 npm。

```bash
# 1. 克隆代码并安装依赖
git clone https://github.com/wii-me/cf-navs-transfer.git
cd cf-navs-transfer
npm install

# 2. 登录 Cloudflare 账号
npx wrangler login
npx wrangler whoami

# 3. 创建所需边缘资源（如云端已有对应名称资源可跳过创建）
npx wrangler d1 create cf-navs-db
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create cf-navs-storage

# 4. 自动抓取并写入当前账号真实资源 ID 到 wrangler.local.toml
npm run setup:wrangler

# 5. 首次部署创建 Worker 实例
npm run deploy

# 6. 配置首次安装凭证 Secret
npx wrangler secret put SETUP_TOKEN

# 7. 一键初始化远程 D1 数据库完整表结构（包含导航表与便笺传输表）
npm run db:init:remote

# 8. 重新部署使全部资源绑定生效
npm run deploy
```

部署成功后，终端将输出你的 Worker 访问域名。直接访问 `https://<your-worker>.workers.dev/install` 输入令牌完成初始化。

---

## 🛠️ 本地开发

克隆项目后即可在本地完全模拟 Cloudflare Workers 边缘运行环境：

```bash
# 1. 终端 1：启动后端 Worker 模拟环境（Miniflare）
npm run dev

# 2. 终端 2：启动前端 Vite 开发热更新服务器
npm run dev:web
```

访问 `http://localhost:5173` 即可实时预览并进行开发。

### 常用代码检查与测试命令
```bash
# 语法与类型校验
npm run type-check

# 单元与集成测试（Vitest）
npm test

# 生产环境打包构建验证
npm run build
```

---

## 🏗️ 架构与项目结构

### 技术栈全景
| 层次 | 核心技术 | 优势说明 |
|---|---|---|
| **前端展现** | **Svelte 5** + **TypeScript** + **Vite 7** | 极小体积、无虚拟 DOM 开销、极速反应 |
| **交互与动效** | **SortableJS** + 原生 CSS Variables | 丝滑的拖拽重排与 22 套动态主题切换机制 |
| **边缘 API** | **Hono** + **Cloudflare Workers** | 毫秒级冷启动、标准 Web Fetch 规范适配 |
| **持久存储** | **Cloudflare D1 (SQLite)** | 边缘低延迟分布式 SQL 关系数据库 |
| **缓存鉴权** | **Cloudflare KV** | 全球毫秒级读取、无锁会话黑名单与防刷限流 |
| **对象存储** | **Cloudflare R2** | 兼容 S3 协议、0 出网流量费用的高可用文件仓库 |

### 目录结构树
```text
cf-navs-transfer/
├── src/                 # Svelte 5 前端视图与交互组件
│   ├── components/      # 便笺传输助手 (TransferNotes)、书签卡片、灯箱预览等
│   ├── routes/          # 首页、后台管理 (/admin)、初始化 (/install) 路由
│   └── stores/          # 响应式全局状态与持久化配置
├── worker/              # Cloudflare Workers 后端核心
│   ├── routes/          # API 路由（书签、分类、便笺、文件上传与下载）
│   ├── middleware/      # PBKDF2 鉴权、频控限流、安全响应头中间件
│   └── services/        # D1 数据库交互、R2 对象上传与生命周期清理
├── shared/              # 前后端共享 TypeScript 类型与常量
├── public/              # PWA 清单、网站图标与静态资源
├── browser-extension/   # Chrome / Edge 浏览器新增书签同步插件
├── tests/               # Vitest 单元测试与端到端回归脚本
├── docs/                # 详细架构说明、部署排障与设计文档
├── schema.sql           # 生产数据库建表脚本（含书签导航与传输便笺表）
└── wrangler.toml        # Cloudflare Worker 架构配置定义
```

---

## 💾 数据备份与多格式迁移

不用担心数据被绑定，CF-Navs Transfer 具备极高的数据自主可控性：

- **CF-Navs 原生 JSON 备份**：支持全量或按单分类导出，支持选择是否携带全站主题与站点配置；导入支持“增量追加”或“全量覆盖”。
- **Sun-Panel 一键导入**：兼容 Sun-Panel 导出的备份数据，自动转换分类层级与图标格式。
- **浏览器标准书签 HTML 导入**：支持从 Chrome, Edge, Safari, Firefox 导出的标准书签文件，自动智能映射为双层分类。
- **浏览器扩展极速收集**：安装 [`browser-extension`](browser-extension/) 后，可在日常浏览网页时一键将书签存入导航页指定分类。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q1: 刚完成部署，访问 <code>/install</code> 提示数据表不存在或报错？</b></summary>
<br>
这是因为 D1 数据库尚未执行建表语句。请按照前文指引：
1. 打开 Cloudflare 控制台 → <b>D1 SQL Database</b> → 找到绑定的 <code>cf-navs-db</code>。
2. 进入 <b>Console</b> 控制台，将本仓库根目录下的 <a href="schema.sql"><code>schema.sql</code></a> 内容完整复制粘贴进去并点击执行。
3. 执行成功后刷新 <code>/install</code> 即可正常进入初始化管理员界面。
</details>

<details>
<summary><b>Q2: 便笺传输助手上传大文件支持多大？会产生额外费用吗？</b></summary>
<br>
目前单文件上传限制最高支持 <b>50 MB</b>。
文件完全存放在你自己的 Cloudflare R2 存储桶中，R2 拥有极其实惠的计费模型（每月免费提供 10 GB 存储空间和 1000 万次读取，且<b>出网流量完全免费</b>）。对于日常电脑与手机之间的文件/照片传输，完全在 Cloudflare 免费用量包内，无需担心额外账单。
</details>

<details>
<summary><b>Q3: 如何绑定自己的个性化域名？</b></summary>
<br>
进入 Cloudflare 控制台的该 Worker 详情页：
1. 点击 <b>Settings (设置)</b> → <b>Domains & Routes (域和路由)</b>。
2. 点击 <b>Add (添加)</b> → 选择 <b>Custom Domain (自定义域)</b>。
3. 输入你在 Cloudflare 上托管的域名（例如 <code>nav.yourdomain.com</code>），等待 DNS 解析生效即可。
</details>

<details>
<summary><b>Q4: 更新代码或推送新版本后，浏览器打开依然是旧界面？</b></summary>
<br>
CF-Navs Transfer 内置了 PWA 与边缘缓存以提升秒开速度。更新部署后：
1. 在浏览器界面按下 <kbd>Ctrl</kbd> + <kbd>F5</kbd>（Mac 下为 <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>）强制刷新。
2. 新版本的 Service Worker 接管后即可自动加载最新界面。
</details>

<details>
<summary><b>Q5: 如何设置分类或书签仅自己可见？</b></summary>
<br>
在管理员登录状态下：
- <b>私密书签</b>：新建或编辑书签时，勾选“设为私密链接（仅登录可见）”。
- <b>私密分类</b>：在后台编辑分类时，勾选“访客不可见（仅登录可见）”。
- 访客在未登录状态下，接口会严格过滤，根本不会收到该分类及其中书签的任何字段。
</details>

---

## 🤝 贡献与致谢

- 欢迎提交 Issue 反馈问题或建议，欢迎提交 Pull Request 一同完善。在贡献前请阅读 [参与贡献指南](CONTRIBUTING.md)。
- 若发现任何潜在安全缺陷，请通过 [安全策略说明](SECURITY.md) 中的渠道私下通报。
- 本项目借鉴了 [Sun-Panel](https://github.com/hslr-s/sun-panel) 的设计理念，图标抓取思路受到 [iori-nav](https://github.com/jy02739244/iori-nav) 的启发。

---

## 📈 Star History

<div align="center">
  <a href="https://star-history.com/#wii-me/cf-navs-transfer&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=wii-me/cf-navs-transfer&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=wii-me/cf-navs-transfer&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=wii-me/cf-navs-transfer&type=Date" />
    </picture>
  </a>
</div>

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源协议，商业友好，自由分享。

<div align="center">
  <details>
    <summary><b>☕️ 喜欢 CF-Navs Transfer？请作者喝杯咖啡 / Sponsor</b></summary>
    <br>
    <p>如果这个项目提升了你的日常工作与多设备协同效率，欢迎赞助支持！你的支持是保持维护的最大动力 ❤️</p>
    <a href="https://afdian.com/a/benjian" target="_blank">
      <img src="https://img.shields.io/badge/爱发电-前往赞助-946CE6?style=for-the-badge&logo=afdian&logoColor=white" alt="爱发电赞助">
    </a>
    <p><small>💡 赞助支持代搭建指导，详情见爱发电主页</small></p>
  </details>
</div>
