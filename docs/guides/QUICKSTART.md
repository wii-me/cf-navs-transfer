# CF-Navs Transfer 快速开始指南

这是一份简化的部署指南，适合快速上手。完整文档请查看 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 部署方式选择

- **Wrangler CLI 部署**：适合本地可运行命令行的用户，完整控制 D1/KV/R2 创建和部署，并通过 `/install` 完成 schema 与管理员初始化。
- **Cloudflare 控制台在线部署**：适合先 Fork 项目，再通过 Cloudflare 关联 GitHub 自动构建部署的用户。

## 方式一：Wrangler CLI 部署

### 1. 克隆项目并安装依赖

```bash
git clone https://github.com/wii-me/cf-navs-transfer.git
cd cf-navs-transfer
npm install
```

### 2. 创建 Cloudflare 资源

```bash
# 登录 Cloudflare
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create cf-navs-db

# 创建 KV 命名空间
npx wrangler kv namespace create SESSION

# 创建 R2 存储桶（用于便笺文件与图片传输）
npx wrangler r2 bucket create cf-navs-storage
```

### 3. 生成本地 Wrangler 配置

不要把真实 Cloudflare 资源 ID 提交到公开的 `wrangler.toml`。运行下面命令生成 Git 忽略的 `wrangler.local.toml`：

```bash
npm run setup:wrangler
```

### 4. 首次部署 Worker

```bash
npm run deploy
```

- 首轮部署完成后再设置 Secret；Worker 尚未创建时，不能用 `wrangler secret put` 提前写入。

### 5. 设置一次性安装令牌

```bash
npx wrangler secret put SETUP_TOKEN
# 输入足够长的随机值，并安全保存到完成安装
```

### 6. 初始化远程数据库与重新部署

```bash
# 初始化远程 D1 数据库表结构（包含分类、书签与 transfer_notes 便笺传输表）
npm run db:init:remote

# 重新部署使配置与表结构生效
npm run deploy
```

### 7. 完成安装

访问返回的 Workers URL 并打开 `/install`，输入 `SETUP_TOKEN`，再创建管理员用户名和密码。安装器会核对数据库并完成初始化；确认登录成功后，建议删除或轮换 `SETUP_TOKEN`。

部署新版后建议强制刷新一次页面，让新版 Service Worker 接管。首页应同时展示所有一级分类分组；每组默认显示直属书签，一级标题后用括号显示总站点数，二级分类横向标签继续紧随其后，点击后只替换当前分组内容。管理员的新增书签和排序操作与标题保持同一行。输入搜索关键词后应切换到全站一级分类分组结果，清除关键词后恢复各分组此前选择的分类。

在“站点设置”中修改配置时，右侧首页预览会使用未保存的表单值实时展示浅色/深色主题、首页标题、经常访问区域、卡片和布局效果；预览中的自定义 CSS 与页脚 HTML 只在隔离环境中检查，不会执行脚本或保存数据。首页打开书签后会累计点击次数，进入后台“访问分析”会刷新数据并显示总点击、已访问/零访问书签、Top 20 排行和零访问书签分页。

一级标题、二级标签、搜索分组和折叠导航应显示已保存的分类图片、data URI、文字或表情图标。打开浏览器 Network 面板时，刷新首页、上下滚动、搜索和后台切回首页不应让已缓存的普通书签图标重复请求 `/api/icon/*`；HTTP(S) 分类图片可请求 `/api/category-icon/*`，后台预览和新增/编辑弹窗中的 Iconify 图标应请求 `/api/iconify/*`。首页展示已保存的 Iconify 书签图标时可直接请求 `api.iconify.design` 并依赖浏览器 HTTP 缓存，但新增/编辑弹窗中的 Iconify 候选、手动预览和从 `icon-sets.iconify.design` 粘贴的页面链接应走 `/api/iconify/*`。

编辑书签时弹窗应立即显示，随后可在后台调用 `/api/bookmarks/:id/icon-cache/refresh` 刷新普通书签图标缓存；保存书签后也会显式刷新。该请求遇到慢速外站图标时不应长时间卡住保存流程；如果缓存失败但保存的是 `https://favicon.im/...`、Google favicon 或自定义 HTTP(S) 图标，首页仍应使用已保存 URL 显示图标，而不是退成标题首字。

## 方式二：Cloudflare 控制台在线部署

1. 在 GitHub 上 Fork 本仓库（`https://github.com/wii-me/cf-navs-transfer`）。
2. 进入 Cloudflare 控制台的 **Workers & Pages → Create application → Import a repository**，关联 GitHub 并选择你的 fork。已有 Fork 不能使用通用 Deploy Button：该按钮会创建新 GitHub 仓库，不能指定现有 Fork。
3. 生产分支选择 `main`，根目录填写 `/`，Build command 填写 `npm run build`，Deploy command 填写：

```bash
npx wrangler deploy
```

4. 保存并完成首轮生产部署。Cloudflare 的 Git 引导流程会根据 `wrangler.toml` 声明创建并绑定 `DB` D1 数据库、`SESSION` KV 命名空间与 `STORAGE` R2 存储桶。若控制台未自动创建 R2，可进入 R2 控制台新建桶 `cf-navs-storage` 并在 Worker 设置中添加变量名为 `STORAGE` 的 R2 绑定。

5. 首轮部署完成后，在该 Worker 的 **设置 → 变量和密钥** 中选择**生产环境**，添加一个类型为**密钥**的变量，变量名填写 `SETUP_TOKEN`，值填写一段足够长且随机的字符串。
6. 保存 Secret 后重新触发生产分支部署。打开部署后的 Workers URL，并访问 `/install`。输入 `SETUP_TOKEN`，再设置管理员用户名和密码；安装器会初始化数据库 schema 和管理员账号。
7. 进入该 Worker 的 **域和路由** 页面，关闭两个 Workers URL，然后添加并启用你的自定义域名。

> 💡 **提示**：若打开 `/install` 提示数据表未初始化，可以在控制台的 D1 数据库控制台（Console）执行一次 [schema.sql](../../schema.sql)，或在本地运行 `npm run db:init:remote` 即可。

`package.json` 的 Cloudflare Git 元数据声明 D1/KV/R2 资源，不声明 `SETUP_TOKEN` 或旧版恢复 Secret，因此 GitHub 导入不会自动生成或填充 Secret 参数。正常路径无需 Cloudflare API Token、GitHub Actions 或手动 SQL；首次部署请从生产分支 `main` 触发，资源创建完成前不要使用预览分支自动部署。

## 🔑 首次登录

### Cloudflare Git 或 Wrangler CLI 新安装

1. 访问 `https://你的站点/install`
2. 输入部署时保存的 `SETUP_TOKEN`
3. 设置管理员用户名和密码
4. 安装完成后按页面提示登录
5. 确认登录成功后，建议进入该 Worker 的 **设置 → 变量和密钥** 删除或轮换 `SETUP_TOKEN`

### 旧数据库升级 / 凭据恢复

`INIT_ADMIN_USER`、`INIT_ADMIN_PASSWORD` 和 `RESET_ADMIN_CREDENTIALS` 仅用于已有旧数据库的升级或凭据恢复，不是全新 Wrangler CLI 安装入口。旧数据库首次升级时，可设置一个新的 `RESET_ADMIN_CREDENTIALS` 标记后重新部署一次。

登录成功后会回到前台首页，需要进入后台时再次点击右上角管理入口。

## 📝 下一步

- 点击右上角传输助手图标或快捷键 `Ctrl+J` / `Cmd+J`，体验**传输助手**（剪贴板 `Ctrl+V` 贴图贴字、拖拽上传最大 50MB 文件、大图灯箱预览与自动自毁）
- 在“站点信息”中修改标题、标题颜色和字号
- 如需外部上传入口，在“站点信息 → 外部资源”配置图床服务地址
- 添加书签和分类
- 新增书签时选择文字图标配色方案
- 登录后在首页右键书签进行快捷编辑
- 在“外观与卡片”中选择配色、卡片展示方式；需要时展开背景、尺寸和卡片表面高级设置
- 配置搜索引擎
- 在“站点信息”中配置首页标题显示、搜索框、搜索引擎选择器和“经常访问”展示数量
- 在“访问分析”中查看书签点击排行与零访问书签

完整功能说明请查看 [README.md](../../README.md)。

## ❓ 遇到问题？

1. 检查 [DEPLOYMENT.md](DEPLOYMENT.md) 中的故障排查部分
2. 查看 Worker 日志：`npx wrangler tail`
3. 提交 Issue 到 GitHub

---

祝你使用愉快！🎉
