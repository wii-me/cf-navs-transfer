<div align="center">
  <img src="public/icon.png" alt="CF-Navs Transfer 项目图标" width="110" height="110">
  <h1>CF-Navs Transfer</h1>
  <p><strong>基于 CF-Navs 增强的云原生个人起始页 · 新增跨设备跨平台传输助手</strong></p>
  <p>
    本项目基于优秀开源项目 <a href="https://github.com/lbjxr/CF-Navs" target="_blank"><strong>CF-Navs</strong></a> 进行二次开发与功能扩展。<br>
    在完整保留原版优雅起始页、两级书签收纳、22 套内置主题与 Serverless 零运维特性的基础上，<br>
    <strong>新增了跨设备、跨平台的传输助手（支持便笺记事与 80MB 大文件极速传输）</strong>，让个人导航页无缝升级为多端协同的数字中枢。
  </p>

  <p>
    <a href="https://github.com/lbjxr/CF-Navs"><img src="https://img.shields.io/badge/Based%20On-CF--Navs%20v0.9.7-0052CC?logo=bookmark&logoColor=white" alt="Based on CF-Navs v0.9.7"></a>
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v0.9.7--transfer-2ea44f?logo=git&logoColor=white" alt="Version"></a>
    <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
    <a href="https://developers.cloudflare.com/d1/"><img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1"></a>
    <a href="https://developers.cloudflare.com/kv/"><img src="https://img.shields.io/badge/Cloudflare-KV-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare KV"></a>
    <a href="https://developers.cloudflare.com/r2/"><img src="https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare R2"></a>
    <a href="https://svelte.dev/"><img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-2563EB" alt="Apache License 2.0"></a>
  </p>

  <p>
    <a href="#-近期更新日志">📢 更新日志</a> ·
    <a href="#-核心功能矩阵">功能矩阵</a> ·
    <a href="#-增强特性跨设备跨平台传输助手">传输助手</a> ·
    <a href="#️-界面展示">界面展示</a> ·
    <a href="#-快速部署指南3分钟极速上线">快速部署</a> ·
    <a href="#-部署后初始化与新手使用指引">初始化设置</a> ·
    <a href="#️-快捷键速查">快捷键</a> ·
    <a href="#-常见问题-faq">常见问题</a> ·
    <a href="CHANGELOG.md">完整变更记录</a>
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

**Languages:** [English](translations/en/README.md)

---

## 📢 近期更新日志

> 详细历史与代码提交记录请查阅项目完整文件：[`CHANGELOG.md`](CHANGELOG.md)。

<details open>
<summary><b>🔥 最新版本亮点：v0.9.7-transfer</b></summary>
<br>

* ⚡ **跨设备传输助手核心能力**：
  * **实时进度条与瞬时速率**：基于 XHR 上传流，抽屉底部实时呈现动态进度条、已传/总量（如 `35.2 MB / 80.0 MB`）、实时网速（如 `2.4 MB/s`）与剩余倒计时；
  * **剪贴板极速截屏上传 (`Ctrl+V`)**：窗口级监听剪贴板图片直接流式上传至 R2 对象存储，无需保存本地中转；
  * **80MB 大文件直传与防误触保护**：单文件上限放宽至 80MB；点击删除瞬时锁定并激活 400ms 位移安全冷却，杜绝连击误删；
  * **下载安全沙箱与过期自动清理**：注入严格 Anti-XSS CSP 沙箱；惰性轮询过期自动异步清理，出网流量零资费。
* 🚀 **同步官方 v0.9.1 ~ v0.9.7 核心升级**：
  * **空一级分类高频书签聚合恢复**：一级分类保持选中并显示其子分类常用书签（#43）；
  * **书签编辑即时响应反馈**：右键编辑立即显示外壳读取弹窗，按主键单条精确获取；
  * **Spotlight 搜索无结果快速新增书签**：搜索无结果时直接回车或点击“新增书签”，自动预填网址；
  * **右上角设置菜单体验升级**：入口改为齿轮图标，鼠标悬停展开并在移出后延时 3 秒收起；
  * **Docker 自托管支持**：主仓库官方 Docker 镜像与容器化支持，双运行时兼备；
  * **浏览器扩展同步与会话管理优化**：多标签页扩展同步会话隔离与待处理清单状态保持。
</details>

---

## 💡 项目定位与背景

- **原版 CF-Navs 的卓越基因**：由 [lbjxr](https://github.com/lbjxr) 开发的原版 [CF-Navs](https://github.com/lbjxr/CF-Navs) 依托 Cloudflare Workers + D1 + KV 架构，实现了**免服务器、零成本、秒开响应**的优秀个人起始页。
- **日常痛点：跨设备流转繁琐**：多设备（PC、Mac、手机、平板）协同中，临时互传验证码、备忘文本、截屏或安装包，以往需依赖微信/QQ文件传输助手或第三方网盘。
- **CF-Navs Transfer 的解法**：在原生架构中深度整合 Cloudflare R2 对象存储，内置开箱即用的**传输助手**。在起始页内随时按下 <kbd>Ctrl</kbd> + <kbd>J</kbd> 唤出，支持剪贴板截屏直接粘贴发送、80MB 大文件极速中转、大图无损灯箱缩放与自动到期销毁。**既是好看好用的浏览器起始页，又是触手可及的多端中转站。**

---

## 📦 核心功能矩阵

| 模块分类 | 功能特性 | 原版 CF-Navs | CF-Navs Transfer (本项目) |
|---|---|:---:|:---:|
| **架构基座** | Cloudflare Workers + D1 (SQLite) + KV 边缘计算 | ✅ | ✅ |
| **持久存储** | Cloudflare R2 极速对象存储（10GB 免费存储，0 出网流量费） | ❌ | ✅ **原生深度集成** |
| **协同工具** | **跨设备传输助手**（剪贴板贴图、便笺、80MB 大文件流式中转） | ❌ | ✅ **独家内置 (<kbd>Ctrl</kbd>+<kbd>J</kbd>)** |
| **可观测性** | 上传实时动态进度条、瞬时传输速率 (MB/s) 与倒计时 | ❌ | ✅ **原生 XHR 进度流** |
| **交互防护** | 批量删除/单项删除防误触 Spinner 与 400ms 位移冷却锁 | ❌ | ✅ **贴心防误删机制** |
| **安全沙箱** | 下载附件注入严格 Anti-XSS CSP 沙箱防护 | ❌ | ✅ **全面加固** |
| **起始页视觉** | 22 款精美内置主题、深浅护眼模式、毛玻璃特效 | ✅ | ✅ |
| **快捷检索** | Spotlight 全局居中搜索、拼音检索、空结果快速新建书签 | ✅ | ✅ |
| **分类组织** | 支持两级分类收纳、拖拽重排、移动端一键归纳 | ✅ | ✅ |
| **数据隐私** | 私密分类与私密书签物理隔离，访客接口彻底过滤 | ✅ | ✅ |
| **图标引擎** | Local-first 本地缓存 v2、多源自动补全与 Epoch 增量拉取 | ✅ | ✅ |
| **浏览器同步** | Chrome/Edge 浏览器扩展一键追加同步与多标签会话 | ✅ | ✅ |

---

## ⚡ 增强特性：跨设备跨平台传输助手

```
 💻 PC / 终端                    ☁️ Cloudflare 全球边缘网络                📱 手机 / 平板
┌──────────────┐               ┌───────────────────────────────┐        ┌──────────────┐
│  快捷键/贴图  │  HTTPS 加密   │  • Workers 边缘网关与安全校验  │  极速   │  触手可及    │
│  Ctrl+V 发送 ├──────────────►│  • D1 数据库 (便笺元数据索引)  ├───────►│  随时下载    │
│  80MB 附件   │               │  • R2 对象存储 (附件直存直传)  │  查阅   │  即阅即焚    │
└──────────────┘               └───────────────────────────────┘        └──────────────┘
```

1. **多端秒速唤出**：
   - 在已登录管理态下，全局随时按下 <kbd>Ctrl</kbd> + <kbd>J</kbd>（Mac 下为 <kbd>Cmd</kbd> + <kbd>J</kbd>）即可开合侧边抽屉；移动端点击右上角菜单即可开启。
2. **剪贴板极速截屏同步 (`Ctrl+V`)**：
   - 截屏后无需保存到本地桌面，在抽屉内按下 `Ctrl+V` 直接流式上传，手机端刷新即见原图。
3. **80MB 大文件与原图传输**：
   - 单文件容量上限放宽至 80MB；前端底层封装原生 XHR 进度事件，实时反馈上传网速与剩余时间。
4. **轻量便笺与超链接自动识别**：
   - 支持纯文本留言与长文备忘，自动识别文本中的 URL 生成可点击超链接，并经过严格的 XSS 转义防护。
5. **智能生命周期与隐私销毁**：
   - 支持设置 1天、3天、7天 到期时间或永久保存；系统在拉取时异步执行物理清理，不占用额外 Worker 费用。

---

## 🖼️ 界面展示

<table>
  <tr>
    <td align="center" width="50%">
      <strong>亮色模式（护眼 / 毛玻璃对比）</strong><br><br>
      <img src="docs/screenshots/cf-navs-light.webp" alt="亮色首页">
    </td>
    <td align="center" width="50%">
      <strong>暗色模式（护眼 / 毛玻璃对比）</strong><br><br>
      <img src="docs/screenshots/cf-navs-dark.webp" alt="暗色首页">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>移动端自适应布局</strong><br><br>
      <img src="docs/screenshots/cf-navs-light-mobile.webp" alt="移动端首页" width="260">
    </td>
    <td align="center" width="50%">
      <strong>个性化后台设置面板</strong><br><br>
      <img src="docs/screenshots/cf-navs-admin-setting.webp" alt="主题与站点设置面板" width="400">
    </td>
  </tr>
</table>

---

## 🚀 快速部署指南（3分钟极速上线）

本项目基于 Cloudflare 全边缘无服务器架构，**无需自备服务器，零成本免费托管**。

### 🤖 方式一：让 AI 编程助手帮你全自动部署（最省心 ⭐）

> 💡 如果你在使用 **Cursor**、**Claude Code**、**Windsurf**、**GitHub Copilot** 或 **Google Antigravity** 等支持运行命令的 AI 编程助手，把仓库拉取到本地后，**直接把下面这句提示词复制发送给 AI 即可**：

```text
请帮我将当前项目完整部署到我的 Cloudflare 账号下：
1. 检查并确认我的 npx wrangler 登录状态（若未登录请引导我登录）；
2. 检查或自动创建所需的 D1 数据库 (cf-navs-db)、KV 命名空间 (SESSION) 和 R2 存储桶 (cf-navs-storage)；
3. 生成并配置本地 wrangler.local.toml 资源绑定文件；
4. 自动生成一个随机高强度的 SETUP_TOKEN 并写入 Cloudflare Secret，执行远程数据库初始化（运行 schema.sql），完成项目构建与部署；
5. 部署完成后执行线上健康检查，将随机生成的 SETUP_TOKEN 与访问网址汇报给我，并提醒我初次访问 /install 完成管理员密码设置后删除该 Token。
```

---

### 🌐 方式二：Cloudflare 控制台 0 代码一键部署（小白推荐）

1. **开通 R2 存储桶**：登录 [Cloudflare 控制台](https://dash.cloudflare.com/) → **R2 对象存储** → 创建存储桶 `cf-navs-storage`。
2. **Fork 仓库**：点击右上角 **[Fork 本仓库](https://github.com/wii-me/cf-navs-transfer/fork)**。
3. **导入 Cloudflare**：进入 **Workers & Pages** → 点击 **Create** → **务必选择「Workers」标签**（切勿选 Pages）并导入你的 GitHub 仓库。
4. **构建配置**：构建命令填 `npm run build`，部署命令填 `npx wrangler deploy`，并在环境变量添加 `NODE_VERSION` = `24`。
5. **添加资源绑定 (Bindings)**：进入该 Worker **设置 → 绑定**，添加：
   * D1 数据库：变量名 `DB`，数据库选择 `cf-navs-db`；
   * KV 命名空间：变量名 `SESSION`，命名空间选择 `cf-navs-session`；
   * R2 存储桶：变量名 **`STORAGE`**（大写），选择 `cf-navs-storage`。
6. **添加初始化密钥 (`SETUP_TOKEN`)**：在 **设置 → 变量和机密** 中添加 **Secret**（加密密钥）`SETUP_TOKEN`，填入一段复杂随机字符，保存后**在 Deployments 页面点击「Retry deployment (重新部署)」生效**。
7. **执行建表 SQL**：进入 **D1 SQL Database** → 点击数据库 → **Console**，把根目录下的 [`schema.sql`](schema.sql) 完整内容复制进去并执行。
8. **访问 `/install` 初始化**：打开你的 Worker 域名并在末尾追加 `/install`（如 `https://cf-navs.xxx.workers.dev/install`），输入 `SETUP_TOKEN` 并设置管理员密码（**系统强制要求 ≥12 位**）即告完成！

> 📖 如需查阅带每一步后台截图的详细教程，请参考 [完整图文部署指南 (DEPLOYMENT.md)](docs/guides/DEPLOYMENT.md)。

---

### 💻 方式三：Wrangler CLI 极速部署（开发者推荐）

本地具备 Node.js 22+ 或 24 LTS 环境，在终端中执行以下命令：

```bash
# 1. 克隆并安装依赖
git clone https://github.com/wii-me/cf-navs-transfer.git && cd cf-navs-transfer && npm install

# 2. 登录 Cloudflare 并创建资源
npx wrangler login
npx wrangler d1 create cf-navs-db
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create cf-navs-storage

# 3. 自动匹配资源 ID 生成本地配置并首次部署
npm run setup:wrangler && npm run deploy

# 4. 设置初始化密钥并初始化数据库
npx wrangler secret put SETUP_TOKEN
npm run db:init:remote

# 5. 重新部署使所有配置生效
npm run deploy
```

部署完成后访问 `https://<your-worker>.workers.dev/install` 设定管理员密码即可。

> 💡 **Docker 容器化自托管备选方案**：若您希望使用私有 VPS / 云服务器进行独立部署（内置 Node.js 与 SQLite 数据持久化），可使用项目自带的官方 Docker 容器方案，详见 [Docker 自托管部署指南 (DOCKER_DEPLOY.md)](docs/guides/DOCKER_DEPLOY.md)。

---

<details>
<summary><b>🚨 部署与排坑对照速查表（点击展开）</b></summary>
<br>

| 异常现象 / 报错信息 | 根本原因 | 一分钟排查与解决方案 |
|---|---|---|
| **构建报错**：`unsupported engine` 或打包语法错误 | Cloudflare 默认 Node.js 版本过低（低于 22.12） | 在 Worker **Settings → Builds** 环境变量中添加 `NODE_VERSION` = `24` 并重新部署。 |
| **部署后访问**：直接出现 `404 Not Found` 无法进入任何页面 | 在 Cloudflare 导入仓库时误选了 **Pages** 而非 **Workers** | 删除该 Pages 项目，在 **Workers & Pages** 下务必选择 **Workers** 标签重新导入。 |
| **访问 `/install` 提示**：「还缺少部署密钥 (setup_token_missing)」 | 未添加 Secret，或添加后**未重新部署**实例未热加载 | 确认 `SETUP_TOKEN` 为 **Secret** 类型；在 **Deployments** 页面点击最新部署右侧的 **Retry deployment (重新部署)**。 |
| **访问 `/install` 提示**：「还缺少存储绑定 (missing DB/SESSION/STORAGE)」 | Worker 未正确绑定 D1、KV 或 R2 存储桶 | 进入 Worker **设置 → 绑定**，确认名为 `DB` (D1)、`SESSION` (KV) 和 `STORAGE` (R2) 的三个大写绑定。 |
| **传输助手上传附件报错**：`R2 storage is not configured` (HTTP 500) | Worker 缺少 R2 绑定，或绑定变量名未大写为 `STORAGE` | 控制台开通 R2 并创建 `cf-navs-storage`；Worker 绑定中添加 R2 绑定，**变量名务必填写大写 `STORAGE`**。 |
| **创建管理员提示**：「密码不符合安全规范」或提交无响应 | 管理员密码少于 12 位（底层强校验 `MIN_PASSWORD_LENGTH = 12`） | 设置 12 位及以上的强密码（例如字母、数字和符号组合 `Admin@2026SecureNav`）。 |
| **访问首页或 `/install` 提示**：数据表不存在或 SQL 错误 | D1 数据库未执行建表脚本 | 进入 Cloudflare 控制台 **D1** → **Console**，完整粘贴 [`schema.sql`](schema.sql) 并执行。 |
| **CLI 命令行部署报错**：`Worker not found` 或 `secret put` 失败 | 在首次执行 `npm run deploy` 之前就尝试写入 Secret | 遵循正确顺序：先运行 `npm run deploy` 创建 Worker 实例，然后再运行 `npx wrangler secret put SETUP_TOKEN`。 |

</details>

---

## 🎯 部署后初始化与新手使用指引

1. **设置管理员密码 (`/install`)**：访问站点末尾追加 `/install`，输入 `SETUP_TOKEN`，设置管理员账号与密码（**强制 ≥12 位**），提交后系统自动完成首次登录并进入首页。
2. **安全收尾**：首次安装成功后，请前往 Worker **设置 → 变量和机密** 中**删除 `SETUP_TOKEN`**（彻底消除未授权访问隐患，后续若遗忘密码可通过 `/recover` 安全恢复）。
3. **日常登录入口**：点击页面右上角或浮动条的管理入口（锁形图标），或直接访问 `/admin`。
4. **一键导入书签**：进入后台「数据管理 → 备份与恢复」，支持直接导入浏览器导出的 HTML 书签或 Sun-Panel / 原版 CF-Navs JSON 备份，自动映射两层分类。
5. **畅享传输助手**：随时按下快捷键 <kbd>Ctrl</kbd> + <kbd>J</kbd>（Mac 上为 <kbd>Cmd</kbd> + <kbd>J</kbd>），体验剪贴板 `Ctrl+V` 贴图、80MB 大文件上传与防误删特性。

---

## ⌨️ 快捷键速查

| 快捷键 | 作用域 | 功能说明 |
|---|---|---|
| <kbd>Ctrl</kbd> + <kbd>J</kbd> / <kbd>Cmd</kbd> + <kbd>J</kbd> | 全局 | 随时呼出或收起**传输助手**窗口 |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>Cmd</kbd> + <kbd>K</kbd> | 全局 | 随时呼出或关闭 **Spotlight 居中搜索命令面板** |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> / <kbd>Cmd</kbd> + <kbd>V</kbd> | 传输助手面板 | 直接粘贴文本，或将剪贴板截屏作为附件直接上传 |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd> | 传输助手输入框 | 快速提交并发送当前便笺与附件 |
| <kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>Enter</kbd> | Spotlight 面板 | 键盘选择书签并直接打开（高亮项自动滚入视野） |
| <kbd>Esc</kbd> | 全局 | 关闭当前打开的大图灯箱预览、设置弹窗、Spotlight 或传输浮窗 |
| <kbd>/</kbd> | 导航首页 | 快速聚焦站内搜索输入框或唤起 Spotlight 全站检索 |

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q1: 本项目与原版 CF-Navs 有什么区别？</b></summary>
<br>
本项目基于原版 CF-Navs 深度增强。完整继承了极简无服务器架构、两级书签收纳、22 款主题、拖拽整理和高私密性；同时深度融合 Cloudflare R2 对象存储，<b>新增跨设备跨平台传输助手（支持剪贴板贴图、便笺记事、80MB 大文件传输及防误删保护）</b>，让日常使用的起始页同时承担个人中转站角色。
</details>

<details>
<summary><b>Q2: 原版 CF-Navs 老用户升级会丢失数据吗？</b></summary>
<br>
<b>完全不会。</b> 本项目的数据库结构对原版保持 100% 向下兼容。升级只需增加一个 R2 绑定（变量名 <code>STORAGE</code>），并在 D1 中执行增加 <code>transfer_notes</code> 表的 SQL，原有分类、书签与站点设置原封不动保留。
</details>

<details>
<summary><b>Q3: 上传的文件存放在哪里？会产生额外费用吗？</b></summary>
<br>
文件完全存放在你自己的 Cloudflare R2 存储桶中。Cloudflare R2 每月提供 <b>10GB 免费存储容量，且出网流量完全免费</b>。对于日常多设备间的文档、截屏和备忘互传，完全在免费额度之内。
</details>

<details>
<summary><b>Q4: 首次部署后访问 <code>/install</code> 提示数据库表不存在？</b></summary>
<br>
请进入 Cloudflare 控制台的 D1 数据库控制台（Console），将项目根目录下的 <a href="schema.sql"><code>schema.sql</code></a> 内容完整粘贴进去执行一次，执行成功后刷新 <code>/install</code> 即可正常设置管理员密码。
</details>

<details>
<summary><b>Q5: 如何设置私密书签与分类？</b></summary>
<br>
管理员登录后，在新建或编辑书签时勾选“设为私密链接”，或在分类设置中勾选“访客不可见”。未登录访客将无法查看这些数据，接口层会彻底物理过滤私密字段。
</details>

---

## 🤝 致谢与开源协议

- 🌟 **核心致谢**：本项目基于 **[CF-Navs](https://github.com/lbjxr/CF-Navs)**（原作者：[@lbjxr](https://github.com/lbjxr)）进行二次开发与功能增强。衷心感谢原作者的优秀构想与杰出贡献！
- 项目同时参考了 [Sun-Panel](https://github.com/hslr-s/sun-panel) 的设计理念，部分图标获取逻辑受到 [iori-nav](https://github.com/jy02739244/iori-nav) 的启发。
- 本项目遵循 [Apache-2.0 License](LICENSE) 开源协议，项目归属信息详见 [`NOTICE`](NOTICE)。
- 如果你 Fork 或重新分发基于本项目的修改版本，请保留 `LICENSE`、`NOTICE` 与原版权声明，并明确注明基于 CF-Navs。

<hr>

<div align="center">
  <details>
    <summary><b>☕️ 喜欢 CF-Navs Transfer？请原作者与维护者喝杯咖啡 / Sponsor</b></summary>
    <br>
    <p>如果这个项目对你的日常工作有所帮助，欢迎赞助支持原作者团队！❤️</p>
    <a href="https://afdian.com/a/benjian" target="_blank">
      <img src="https://img.shields.io/badge/爱发电-前往赞助-946CE6?style=for-the-badge&logo=afdian&logoColor=white" alt="爱发电赞助">
    </a>
  </details>
</div>
