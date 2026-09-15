<div align="center">
  <img src="public/icon.png" alt="CF-Navs Transfer 项目图标" width="112" height="112">
  <h1>CF-Navs Transfer</h1>
  <p><strong>把常用网站、工作工具和私密收藏收进起始页，并支持跨设备便笺与大文件极速传输。</strong></p>
  <p>运行在 Cloudflare Workers 上，集成 D1、KV 与 R2 对象存储，无需自建服务器。导入已有书签，选好主题，随时随地在电脑和手机间即贴即传文本与文件。</p>

  <p>
    <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
    <img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1">
    <img src="https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare R2">
    <img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2563EB" alt="MIT License"></a>
  </p>

  <p>
    <a href="#功能">功能</a> ·
    <a href="#跨设备便笺与文件传输助手-transfer-notes">便笺与传输</a> ·
    <a href="#界面预览">界面预览</a> ·
    <a href="#快速部署">快速部署</a> ·
    <a href="#本地开发">本地开发</a> ·
    <a href="docs/README.md">项目文档</a>
  </p>

  <a href="https://github.com/wii-me/cf-navs-transfer/fork">
    <img src="https://img.shields.io/badge/Fork_on_GitHub-181717?logo=github&logoColor=white" alt="Fork on GitHub">
  </a>
</div>

---

## 功能

**收藏得多，也能找得快、理得清；设备之间，文字文件随手传。** CF-Navs Transfer 将两级分类、全站搜索、批量整理、数据备份与**跨设备便笺文件传输助手**融合在一起，既是个人日常起始页与资源导航，又是电脑与手机之间的极速中转站。访客浏览公开内容，管理员登录后管理全部收藏与私密便笺。

| | 能力 | 说明 |
|---|---|---|
| ☁️ | 边缘全栈 | Workers、D1、KV 与 R2 托管整站与文件，代码和数据留在你自己的 GitHub / Cloudflare 账号下，无需租用 VPS 或维护数据库服务 |
| 📦 | 便笺与传输 | 跨设备轻量便笺与文件传输助手，支持随手记、剪贴板 Ctrl+V 即贴即传、拖拽上传单文件最高 50MB（依托 R2 对象存储）、大图灯箱预览、安全下载与多档 TTL 生命周期自动清理 |
| 🧭 | 导航首页 | 一级分组与二级分类清晰呈现，支持标题、URL、描述和完整分类路径搜索；左侧、顶部与移动端导航适配不同屏幕，顶部导航可分行展示 |
| 🏠 | 首页设置 | 站点标题、搜索框、搜索引擎选择器和“经常访问”数量均可配置，保存前可实时预览；登录后可直接在首页新建主分类与子分类 |
| 🛠️ | 后台管理 | 分类编辑、移动、同级排序与删除保护，配合完整路径定位和书签批量移动，减少逐条编辑；站点、布局、搜索、备份与账号安全集中管理 |
| 🔒 | 私密书签 | 新增或编辑书签时可标记为“私密链接（仅登录可见）”；普通访客不会收到私密书签数据，管理员登录后可正常浏览和管理 |
| 🗂️ | 私密分类 | 分类可设置为“访客不可见（仅登录可见）”；访客不会看到该分类、子分类及其中的书签，管理员登录后仍可正常管理 |
| ↕️ | 跨分类排序 | 支持一级、二级及空分类目标之间移动书签，也能调整分类内顺序；PC 使用拖拽，手机提供“移动到分类”入口，统一保存或取消 |
| 🔄 | 浏览器书签同步 | 可在后台开启单向同步；Chrome/Edge 扩展将之后新增的书签统一放入“浏览器新增收藏”，不改变现有分类，也不会删除导航页书签 |
| 📊 | 访问分析 | 首页书签点击会累计访问次数，后台提供总点击、已访问/零访问书签统计、最常访问 Top 20 排行和零访问书签分页列表；进入分析页时会刷新最新数据 |
| 🎨 | 外观定制 | 22 套内置主题、亮暗模式、背景与强调色，分类字号和图标尺寸可按一级/二级分别设置；卡片尺寸、透明度与页脚 HTML / CSS / JavaScript 均可定制，CSS 与页脚支持隔离预览 |
| 🔎 | 搜索与图标 | 全站分组搜索、可配置的外部搜索引擎，以及书签 Favicon / Iconify 与分类图片、文字和表情图标展示 |
| 💾 | 数据迁移 | 全量或按分类导出备份，按需携带站点设置；JSON 追加合并或覆盖恢复，兼容 Sun-Panel 数据与浏览器书签 HTML |
| 🔐 | 安全认证 | PBKDF2 密码哈希、Bearer Session Token、CSP、管理员接口鉴权与登录失败限流；私密图标有访问授权和缓存隔离 |
| ⚡ | 加载优化 | 代码分割、边缘缓存、本地快照、图标懒加载与基础 PWA 离线回退；后台直达刷新不会先闪现首页 |

喜欢紧凑布局？桌面详情卡片宽度最低可设为 **40 px**，移动端仍保留 **150 px** 安全下限。极窄卡片会压缩标题和描述，更适合以图标为主的导航。

### 跨设备便笺与文件传输助手 (Transfer Notes)

<p align="center">
  <img src="docs/screenshots/cf-navs-transfer-assistant.png" alt="CF-Navs Transfer 便笺传输助手界面" width="360">
</p>

- **轻量便笺 & 随手记**：随时记录文字、链接、备忘指令或代码片段，支持多端即时查阅。
- **剪贴板即贴即传 (Ctrl+V)**：在传输窗口内直接按下快捷键 `Ctrl+V`（或移动端粘贴），自动识别纯文本或将剪贴板中的截屏图片直接上传发送，无需手动另存为文件。
- **大文件极速传输 (R2 存储)**：原生深度集成 Cloudflare R2 对象存储，支持常见文档、压缩包、媒体及安装包等任意格式拖拽或点击上传，单文件最高支持 **50 MB**，完全不消耗 D1 数据库或 KV 的行数与存储配额。
- **图片缩略与全屏灯箱**：图片附件自动生成高清预览缩略图，点击即可进入全屏灯箱模式无损查看原图，支持一键安全下载与重命名保存。
- **多档生命周期策略 (TTL)**：内置 **1 小时**、**1 天**、**7 天** 及 **永久有效** 等多档保留策略，到期由边缘调度机制安全清理，避免占用多余存储空间；支持随时手动一键删除销毁。
- **全局无感快捷呼出 (Ctrl+J)**：在任意页面均可通过快捷键 `Ctrl+J` / `Cmd+J`，或点击导航栏右上角传输图标随时呼出/隐藏半浮动传输窗口，即用即走，不打断正常浏览与工作流。
- **权限安全隔离**：与主站管理鉴权深度融合，访客模式与管理模式权限边界清晰。

### 书签隐私与跨分类排序

- **首页直接整理**：登录后可新建主分类，或在当前分组下新建子分类；创建后自动定位。编辑书签时，分类选择器会展开并定位当前分类，减少反复查找。
- **私密链接**：管理员在新增或编辑书签时勾选“设为私密链接（仅登录可见）”。未登录访客的公开数据接口会过滤这类书签；管理员登录后仍可在首页和后台查看、编辑与删除。
- **私密分类**：管理员在后台编辑分类时勾选“访客不可见（仅登录可见）”。未登录访客不会收到该分类、其子分类及其中书签的数据；管理员登录后仍可正常查看和管理。旧分类默认保持访客可见。
- **跨分类拖拽**：管理员登录后，在首页任意分类点击“排序”，进入统一排序会话。PC 可将书签拖入一级、二级或空分类并调整位置；手机可通过“移动到分类”选择目标。点击底部“保存排序”后统一保存分类和顺序，点击“取消”则放弃本次修改。
- **批量移动**：大量书签需要重新归类时，在后台筛选、勾选多条书签，再选择目标分类并确认完整路径，一次完成移动，不必逐条打开编辑框。
- **浏览器书签同步**：在后台“设置 → 站点设置”开启“浏览器书签同步”后，会自动创建“浏览器新增收藏”分类。安装 [`browser-extension`](browser-extension/) 中的 Chrome/Edge 扩展并登录后，浏览器之后新增的网页书签会统一同步到该分类，并按默认图标策略保存 `https://favicon.im/<hostname>?larger=true` 图标候选。扩展不按浏览器收藏夹文件夹创建导航分类，只做“浏览器 → 导航页”单向新增，不删除或反向覆盖导航页已有书签；整理时可直接在首页排序模式中拖到其他分类。

## 界面预览

<p align="center">
  <strong>便笺与文件传输助手（跨设备极速中转）</strong><br>
  <img src="docs/screenshots/cf-navs-transfer-assistant.png" alt="CF-Navs Transfer 便笺传输助手：文件下载、图片缩略与文本随手记" width="360">
</p>

<table>
  <tr>
    <td align="center" width="50%">
      <strong>亮色首页</strong><br>
      <img src="docs/screenshots/cf-navs-light.webp" alt="CF-Navs 亮色首页：护眼与毛玻璃对角线对比">
    </td>
    <td align="center" width="50%">
      <strong>暗色首页</strong><br>
      <img src="docs/screenshots/cf-navs-dark.webp" alt="CF-Navs 暗色首页：护眼与毛玻璃对角线对比">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>移动端亮色</strong><br>
      <img src="docs/screenshots/cf-navs-light-mobile.webp" alt="CF-Navs 移动端亮色首页：护眼与毛玻璃对角线对比" width="260">
    </td>
    <td align="center" width="50%">
      <strong>移动端暗色</strong><br>
      <img src="docs/screenshots/cf-navs-dark-mobile.webp" alt="CF-Navs 移动端暗色首页：护眼与毛玻璃对角线对比" width="260">
    </td>
  </tr>
</table>

首页预览以对角线对比两种外观：左下为护眼主题，右上为毛玻璃主题。

<p align="center">
  <strong>主题与站点设置</strong><br>
  <img src="docs/screenshots/cf-navs-admin-setting.webp" alt="CF-Navs 主题与站点设置">
</p>

更多界面截图位于 [`docs/screenshots`](docs/screenshots)。

## 快速部署

**不想折腾服务器？推荐从控制台部署开始。** 准备好 GitHub 和 Cloudflare 账号，按“Fork → 关联仓库 → 设置安装令牌 → 网页初始化”完成部署。正常安装无需手动执行 SQL，也无需填写 Cloudflare API Token。

可从 Cloudflare 免费计划起步，但免费额度并非无限用量；请求、数据库与 KV 操作各有配额，具体以 [Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/) 和 [KV](https://developers.cloudflare.com/kv/platform/pricing/) 官方说明为准。

第一次使用时，请选一种部署方式完整走完，不要混用两套流程。两种方式最终都会通过 `/install` 初始化数据库和管理员账号。

CF-Navs Transfer 需要以下 Cloudflare 资源：

| 资源 | 绑定名 | 用途 |
|---|---|---|
| D1 Database | `DB` | 保存设置、分类、书签及便笺元数据 (`cf-navs-db`) |
| KV Namespace | `SESSION` | 登录限流、点击限流和会话撤销名单 (`cf-navs-session` 或 `SESSION`) |
| R2 Bucket | `STORAGE` | 跨设备传输文件、图片及附件对象存储 (`cf-navs-storage`) |
| Secret | `SETUP_TOKEN` | 手动配置，授权首次安装初始化 |

### 方式一：Cloudflare 控制台部署（推荐）

适合希望全程在浏览器中操作、不想安装本地工具的用户。Cloudflare 关联你的 GitHub Fork 后，会从 `main` 生产分支自动构建和部署；以后同步上游更新时，也请更新这个分支。

1. [Fork 本仓库](https://github.com/wii-me/cf-navs-transfer/fork)，保留 `main` 分支，并确认后续 Cloudflare 构建使用的是你的 Fork。
2. 在 Cloudflare 控制台打开 **Workers & Pages → Create application → Import a repository**，授权 Cloudflare 访问 GitHub，并选择你的 Fork。
3. 在构建配置中填写：
   - 生产分支：`main`
   - 根目录：`/`
   - Build command：`npm run build`
   - Deploy command：`npx wrangler deploy`
   - Node.js：推荐 24 LTS；如需指定版本，在**构建变量**中设置 `NODE_VERSION=24`（[官方说明](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)）
4. 保存并完成第一次 **Production** 部署。正常情况下，Cloudflare 会根据 [`wrangler.toml`](wrangler.toml) 创建并绑定 `DB` D1 数据库、`SESSION` KV 命名空间与 `STORAGE` R2 存储桶。

   首次部署后应能看到这三个绑定。如果未自动绑定 R2 存储桶，可在控制台 **R2** 中创建名为 `cf-navs-storage` 的桶，并在 Worker 的 **设置 → 变量和绑定** 中添加 R2 存储桶绑定，变量名为 `STORAGE`，选择对应的桶即可。

5. 第一次生产部署完成后，在 Worker 的 **设置 → 变量和密钥** 中选择**生产环境**，配置 `SETUP_TOKEN`：
   - 如果列表中已经有 Cloudflare 自动生成的 `SETUP_TOKEN`，请编辑它并替换为你自己保存的值，然后在 **设置 → 构建** 中执行一次**清理缓存**。
   - 如果已有的是普通文本变量而不是密钥，请删除它，再重新添加类型为**密钥**的 `SETUP_TOKEN`。不要同时保留同名的普通变量和 Secret。
   - 如果列表中没有 `SETUP_TOKEN`，请手动添加类型为**密钥**的变量。值使用足够长的随机字符串，不要添加为普通文本变量。
6. 保存 Secret 后重新部署同一个 `main` 生产部署：可以在 **Deployments** 页面对最近一次生产部署执行 **Retry/Redeploy**，也可以向 `main` 推送一个新提交。不要只保存 Secret 后直接访问 `/install`，必须先让新的部署读取到 Secret。
7. 打开部署后的 Workers URL，并访问 `/install`。输入当前生产环境中配置的 `SETUP_TOKEN` 值，再创建管理员用户名和密码。确认安装和登录成功后，建议删除或轮换这个令牌。

> 💡 **提示**：若打开 `/install` 提示数据表未初始化，可以在控制台的 D1 数据库控制台（Console）执行一次 [`schema.sql`](schema.sql)，或在本地终端运行一次 `npm run db:init:remote` 即可初始化。

自定义域名是可选项：先在 **域和路由** 中添加并启用自定义域名，确认它可以正常访问并完成登录，再根据需要关闭 `workers.dev` 地址。如果还没有准备好自定义域名，请保留 Workers URL，不要提前关闭默认访问入口。

### 方式二：Wrangler CLI 部署

前置条件：Node.js **22.12+（22.x）或 24+**、npm 和 Cloudflare 账号，推荐 Node.js 24 LTS。所有资源命令都会作用于当前 Wrangler 登录的账号；如果你有多个 Cloudflare 账号，先用 `npx wrangler whoami` 确认账号。

```bash
git clone https://github.com/wii-me/cf-navs-transfer.git
cd cf-navs-transfer
npm install

npx wrangler login
npx wrangler whoami

# 1. 创建 Cloudflare 资源（如已存在则跳过对应命令）
npx wrangler d1 create cf-navs-db
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create cf-navs-storage

# 2. 将当前账号真实资源 ID 写入本地 wrangler.local.toml
npm run setup:wrangler

# 3. 首轮部署，创建 Worker 实例
npm run deploy

# 4. 配置首次安装授权令牌 Secret
npx wrangler secret put SETUP_TOKEN

# 5. 初始化远程 D1 数据库表结构（重要：包含书签导航表与便笺传输表）
npm run db:init:remote

# 6. 重新部署使配置完全生效
npm run deploy
```

如果 D1 数据库或 KV 命名空间已经存在，不要再次执行 `create` 命令；先使用 `npx wrangler d1 list` 和 `npx wrangler kv namespace list` 确认当前账号中的资源，再运行 `npm run setup:wrangler`。D1 数据库名应为 `cf-navs-db`，KV 绑定名应为 `SESSION`，R2 存储桶名应为 `cf-navs-storage`。

`npm run setup:wrangler` 会把真实资源 ID 写入 Git 忽略的 `wrangler.local.toml`。首次部署后执行 `npm run db:init:remote`，再访问 `/install` 输入 `SETUP_TOKEN` 创建管理员。首次部署完成前不要执行 `wrangler secret put`，因为 Worker 尚未创建。

### 两种方式通用的部署后检查

- `/install` 可以打开，并能使用 `SETUP_TOKEN` 完成管理员账号初始化。
- 能使用刚创建的管理员账号登录后台。
- 分类和书签可以正常保存；刷新页面后数据仍然存在。
- **跨设备便笺与文件传输助手**：点击右上角传输助手图标或按下快捷键 `Ctrl+J` / `Cmd+J` 呼出面板，测试随手记便笺、`Ctrl+V` 粘贴图片、文件拖拽上传（最高 50MB）、全屏灯箱预览与文件安全下载。
- 如果页面仍显示旧版本，先强制刷新，让新版 Service Worker 接管。
- 如果安装或绑定失败，查看 Worker 日志：`npx wrangler tail`。涉及线上数据的命令前，先确认当前 Cloudflare 账号和目标 Worker。

**让导航页马上用起来**：在后台导入一份现有书签，选一套主题，设置需要隐藏的分类或链接，再将站点设为浏览器起始页。之后可以通过浏览器扩展收集新增书签，通过首页排序或后台批量移动持续整理。

更多配置与故障排查请阅读下列文档；部署分支和 Node.js 要求请按本页执行：

- [快速开始](docs/guides/QUICKSTART.md)
- [完整部署指南](docs/guides/DEPLOYMENT.md)
- [常见问题排查](docs/guides/TROUBLESHOOTING.md)

## 本地开发

开发环境使用 Node.js 22.12+（22.x）或 24+，推荐与 CI 一致的 Node.js 24 LTS。

安装依赖：

```bash
npm install
```

分别启动 Worker 和前端开发服务：

```bash
# 终端 1
npm run dev

# 终端 2
npm run dev:web
```

前端默认地址为 `http://localhost:5173`。

常用检查：

```bash
npm run type-check
npm test
npm run build
git diff --check
```

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Svelte 5、TypeScript、Vite 7 |
| Worker API | Hono、Cloudflare Workers |
| 数据与文件存储 | Cloudflare D1、Cloudflare KV、Cloudflare R2 |
| 交互与排序 | SortableJS |
| 测试 | Vitest 4、Svelte Check、真实 Chrome 回归脚本 |

## 项目结构

```text
cf-navs-transfer/
├── src/                 # Svelte 页面、组件（含便笺传输助手）与浏览器端逻辑
├── worker/              # Worker 路由、中间件、R2 对象存储与 D1 数据访问
├── shared/              # 前后端共享类型与设置契约
├── public/              # 图标、PWA 与其他静态资源
├── browser-extension/   # Chrome/Edge 浏览器新增书签同步扩展
├── tests/               # Vitest 单元与回归测试
├── docs/                # 使用指南、技术参考与截图
├── scripts/             # 开发、部署与审计脚本
├── schema.sql           # D1 数据库结构（含导航表与便笺传输表）
└── wrangler.toml        # Cloudflare Worker 公开配置
```

架构、API 和性能契约可在 [项目文档索引](docs/README.md) 中查看。

## 环境配置

| 名称 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `DB` | D1 binding | 是 | 数据库绑定 (`cf-navs-db`) |
| `SESSION` | KV binding | 是 | 登录/点击限流和会话撤销名单存储 |
| `STORAGE` | R2 binding | 是 | 跨设备便笺传输附件与大文件对象存储 (`cf-navs-storage`) |
| `SETUP_TOKEN` | Secret | 首次安装 | 授权 `/install`，安装成功后建议删除或轮换 |
| `SESSION_TTL` | Variable | 否 | 会话有效期，`wrangler.toml` 默认 `2592000` 秒（30 天）；未设置时 Worker 回退为 7 天 |
| `INIT_ADMIN_USER` | Variable | 否 | 仅用于旧数据库升级或凭据恢复 |
| `INIT_ADMIN_PASSWORD` | Secret | 否 | 仅用于旧数据库升级或凭据恢复 |
| `RESET_ADMIN_CREDENTIALS` | Variable | 否 | 旧数据库强制重置凭据时使用的一次性标记 |

不要把真实资源 ID、密码、Token 或其他 Secret 写入仓库。

## 数据导入

已有收藏不用重新录入，后台支持以下数据格式：

- **CF-Navs JSON 备份**：支持全量或按分类导出，保留两层分类关系，并可选择是否携带站点设置；导入时支持按完整路径追加合并或覆盖恢复。
- **Sun-Panel 数据**：分类按一级导入，并转换书签与兼容图标字段，迁移现有导航不必从零开始。
- **浏览器书签 HTML**：导入浏览器导出的标准文件，有效文件夹映射为两层分类，更深路径压平到二级标题。

**只搬需要的那一部分**：可以导出某个主分类及其子分类，也可以只选二级分类，系统会补齐必需的父分类记录，不夹带未选分类的书签。适合把一组工作资源迁到另一套 CF-Navs，或为重点分类单独留一份备份。

导入前请先备份现有数据：**追加模式保留重复链接，覆盖模式会替换全部分类与书签**。部分导出是备份与迁移能力，不是自动去重或双向同步；备份可能包含私密链接和站点设置，请妥善保管。

参阅 [Sun-Panel 数据导入](docs/guides/SUNPANEL_IMPORT.md) 和 [浏览器书签导入](docs/guides/BROWSER_BOOKMARK_IMPORT.md)。

## 贡献

欢迎通过 Issue 反馈使用体验、通过 Pull Request 贡献改进。开始前请阅读 [参与开发](CONTRIBUTING.md)，按改动范围完成验证；安全问题请使用 [私密报告渠道](SECURITY.md)，不要在公开 Issue 中粘贴凭据或私密书签。

## 致谢

项目参考了 [Sun-Panel](https://github.com/hslr-s/sun-panel) 的设计思路，部分图标获取逻辑受 [iori-nav](https://github.com/jy02739244/iori-nav) 启发。

## Star History

<a href="https://www.star-history.com/?repos=lbjxr%2FCF-Navs&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=lbjxr/CF-Navs&type=date&theme=dark&legend=top-left&sealed_token=7kyATdN3x5tJ6WJAhA5MwxWL93j-C9ZnSxJli_vTqztkkZF54Sp95nJzSMW-Xggc19KoraDrqDNjCWN6VuQrSEmOX8CAbyYqMi0I_6K3DS2GEr0x1rgf8VDa2kBJIgOP74JqDldlCFRRbGGNjvrDVJ12e4SIShmH78leu6Vxg6WQzidKg4PULPCzlwi-" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=lbjxr/CF-Navs&type=date&legend=top-left&sealed_token=7kyATdN3x5tJ6WJAhA5MwxWL93j-C9ZnSxJli_vTqztkkZF54Sp95nJzSMW-Xggc19KoraDrqDNjCWN6VuQrSEmOX8CAbyYqMi0I_6K3DS2GEr0x1rgf8VDa2kBJIgOP74JqDldlCFRRbGGNjvrDVJ12e4SIShmH78leu6Vxg6WQzidKg4PULPCzlwi-" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=lbjxr/CF-Navs&type=date&legend=top-left&sealed_token=7kyATdN3x5tJ6WJAhA5MwxWL93j-C9ZnSxJli_vTqztkkZF54Sp95nJzSMW-Xggc19KoraDrqDNjCWN6VuQrSEmOX8CAbyYqMi0I_6K3DS2GEr0x1rgf8VDa2kBJIgOP74JqDldlCFRRbGGNjvrDVJ12e4SIShmH78leu6Vxg6WQzidKg4PULPCzlwi-" />
 </picture>
</a>

## 许可证

本项目采用 [MIT License](LICENSE)。

<!-- 爱发电赞助区 (折叠卡片) -->
<hr>

<div align="center">

<details>
  <summary><b>☕️ 喜欢 CF-Navs？请作者喝杯咖啡 / Sponsor</b></summary>
  <br>
  <p>如果这个项目对你有帮助，欢迎赞助支持！你的支持是维持项目持续更新和维护的最大动力 ❤️</p>
  <a href="https://afdian.com/a/benjian" target="_blank">
    <img src="https://img.shields.io/badge/爱发电-前往赞助-946CE6?style=for-the-badge&logo=afdian&logoColor=white" alt="爱发电赞助">
  </a>
  <p><small>💡 赞助支持代搭建指导,详情见爱发电主页</small></p>
</details>

</div>
