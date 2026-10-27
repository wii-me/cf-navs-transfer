# Node + SQLite + Docker 迁移开发计划

> **文档状态：** 架构与实施计划；尚未实施，不维护任务完成状态，也不代表全部开发阶段已获授权。
> **目标分支：** `docker`（长期维护的 Node/Docker 实现分支）。
> **当前正式运行路径：** Cloudflare Workers + D1 + KV，保持不变。

## 1. 目标与边界

在不改变现有 API、前端行为和 Cloudflare 部署能力的前提下，增加一个可自托管的 Node 服务版本：

- 使用 Node.js 通过 Hono Node adapter 承载现有 Hono Worker 应用。
- 用 SQLite 替代 D1，并兼容当前应用使用的 D1 查询、事务和迁移语义。
- 用带 TTL 的 SQLite KV 替代 Cloudflare KV，持久化登录限流和会话撤销记录。
- 将 Cloudflare `caches.default` 替换为有界、非持久化的 Node 进程内缓存，同时保留 HTTP 与浏览器缓存契约。
- 使用 Docker 镜像、Compose 与持久化卷提供安装、升级、备份和恢复路径。
- 继续支持现有 Cloudflare Worker 部署；不将 `docker` 分支变成 Worker 部署的替代分支。

首版运行边界：**单机、单容器、单 Node 进程、单 SQLite 写入实例**。不承诺多副本共享 SQLite、网络文件系统上的 SQLite、EdgeOne 兼容或完整 Cloudflare D1/KV API 兼容。

## 2. 当前架构基线

- `worker/index.ts` 导出 Hono 应用；API 鉴权、静态资源路由、错误处理与 SPA fallback 位于同一应用。
- `worker/types.ts` 定义 `DB: D1Database`、`SESSION: KVNamespace`、`ASSETS: Fetcher` 等 Worker 绑定。
- `worker/lib/db/` 通过 D1 `prepare/bind/first/all/run/batch` 执行数据访问。`worker/lib/db/mutation.ts` 依赖一个原子 batch 同时提交业务写入与 `data_version`。
- `worker/lib/db/schema.ts` 维护版本化迁移；`schema.sql` 是新安装结构来源，包含索引和触发器。
- `SESSION` 实际用于 `rl:login:*` 登录失败限流与 `revoked:<sha256(token)>` 撤销名单；用户会话本身是无状态 JWT。点击和错误上报限流存于 SQLite/D1 表中。
- `worker/lib/cache.ts`、`worker/lib/iconResponses.ts` 和相关路由使用 Cloudflare `caches.default`。公开数据采用版本化缓存键；图标路径有严格的匿名可见性、授权、`no-store` 和 fallback 分层。
- `worker/lib/assetRouting.ts` 与 `worker/lib/assetHeaders.ts` 管理静态资源、SPA fallback、安全响应头和 HTTP 缓存头。
- `tests/helpers/d1Sqlite.ts` 是现有测试用 SQLite D1 近似适配器，不是生产实现。
- `package.json` 已约束 Node `^22.12.0 || >=24.0.0`；Node 24 内置 `node:sqlite` 仍是 Release Candidate API，须在可行性阶段验证，不能假设已稳定。

主要事实来源：`worker/index.ts`、`worker/types.ts`、`worker/lib/db/`、`worker/lib/cache.ts`、`worker/lib/iconResponses.ts`、`worker/lib/assetRouting.ts`、`schema.sql`、`tests/helpers/d1Sqlite.ts`、`package.json`。

## 3. 目标架构

```text
Cloudflare Worker                     Node Docker
Hono 应用                              Hono 应用
├── D1                                 ├── SQLite D1 兼容适配器
├── KV                                 ├── SQLite 持久化 KV
├── caches.default                     ├── 有界进程内响应缓存
└── Cloudflare Assets                  └── dist 文件适配器
```

共享 API 路由和业务逻辑；运行时差异集中在环境组装和适配层。禁止在每个路由里散布 `isNode` 分支，禁止维护第二份业务 SQL 或第二份 API 实现。

建议新增 Node 运行时模块：

```text
server/
├── index.ts              # HTTP 启动、信号与优雅关闭
├── config.ts             # 环境变量解析和启动校验
├── nodeEnv.ts            # 组装 Hono Env
├── sqliteD1.ts           # D1 使用子集适配器
├── sqliteKv.ts           # KV 使用子集适配器与 TTL 清理
├── responseCache.ts      # 有界 Node 进程内响应缓存
├── fileAssets.ts         # dist 静态资源 Fetcher
├── requestContext.ts     # ExecutionContext、可信代理和请求来源
└── migration.ts          # D1 导出到 SQLite 导入和完整性校验
```

名称可以随实现调整，但职责应维持单一。Node adapter 采用 Hono 官方 `@hono/node-server`，通过 `app.fetch(request, env, executionContext)` 调用共享应用。官方参考：[Hono Node.js adapter](https://hono.dev/docs/getting-started/nodejs)。

## 4. 开发阶段

### 阶段 0：可行性验证与依赖裁定

**目的：** 在做容器和完整适配器前，确认 Node SQLite 与共享 Hono 入口可用。

**工作：**

- 在目标 Node 24 LTS 镜像中加载 `schema.sql`，验证触发器、`PRAGMA`、`RETURNING`、JSON 函数和现有迁移。
- 用原生 SQLite 执行 `BEGIN IMMEDIATE` 批次，验证失败回滚、结果顺序和变更计数。
- 验证 Hono Node adapter 能向共享应用注入自定义 `Env` 和请求上下文。
- 使用现有最大规模导入夹具（2000 分类、20000 书签）测量批次耗时和事件循环阻塞。
- 对照 Node 官方 SQLite 稳定性状态，决定使用 `node:sqlite` 还是改用受维护的 SQLite 驱动；不同时引入两套生产驱动。

**出口条件：** SQL/触发器/原子事务通过；最大导入时延可接受；选定并锁定生产 SQLite 驱动与 Node 镜像版本。若不通过，先解决驱动或执行模型，不继续叠加 Docker 功能。

### 阶段 1：共享 Hono 应用与 Node Env

**工作：**

- 将 Hono app 构造提取为共享工厂，同时保留 Cloudflare Worker 默认导出与原绑定类型。
- 新增 Node Env 组装，将数据库、KV、缓存、静态资源、schema 文本和配置注入 Hono。
- 将 `ExecutionContext.waitUntil`、错误上报与资源关闭定义为明确的 Node 行为；不允许悬空 Promise 或未处理拒绝。
- Cloudflare 路由注册顺序、公开/受保护边界、错误包络和默认鉴权行为保持不变。

**出口条件：** 原 Worker 路径仍能构建；Node 入口可启动并对 `/api/health` 响应；公开/受保护路由测试在两种 Env 下复用。

### 阶段 2：SQLite D1 兼容适配器

**工作：**

- 实现应用当前使用的 D1 子集：`prepare`、`bind`、`first`、`all`、`run`、`batch` 和必要的 `exec`。
- 将 Node SQLite 原生执行结果映射到 D1 结果形状，正确报告 `results`、`success`、`meta.changes` 和 `last_row_id`。
- `batch()` 使用单一事务、保持语句顺序；任一语句错误整体回滚。
- 覆盖 `RETURNING` 结果、触发器副作用、条件写入、外键约束及迁移查询。
- 复用现有 DAO、`Mutation`、`schema.sql` 与版本化迁移，不做 SQL 双写。
- 文件数据库连接单例复用；启用外键、WAL、明确的同步策略和 busy timeout；prepared statement 使用后释放。

**出口条件：** 现有数据库行为测试可运行在生产适配器；新增事务回滚和 `meta.changes` 行为测试；完整 schema 迁移与最大导入验证通过。

### 阶段 3：持久化 KV 与 Node 响应缓存

**工作：**

- 建立独立 KV SQLite 文件，表至少包含 `key`、`value`、`expires_at` 和过期索引。
- 实现当前实际使用的 `get`、`put({ expirationTtl })`、`delete`；读取、写入与后台清理均能删除过期值。
- KV 持久化登录限流和撤销记录；点击与错误上报限流仍留在业务 SQLite 表。
- 抽取缓存接口：Cloudflare 继续使用 `caches.default`；Node 使用有界进程内内存缓存，不持久化响应正文。
- 缓存支持 URL/method key、TTL、最大条目/字节、淘汰、过期清理和 Response clone。
- 拒绝缓存 `private`、`no-store`、授权图标和敏感响应；保留公开数据版本键、设置失效、图标 namespace、fallback 策略与客户端 `no-store`。
- 规定 Node 异步缓存操作的等待与错误处理，不模拟 Cloudflare 的 `waitUntil` 但丢弃 Promise。

**出口条件：** KV 重启后持久、过期后拒绝读取；缓存容量有界；私密数据不进入共享缓存；缓存不可用不破坏业务请求。

### 阶段 4：静态资源和 Node HTTP 服务

**工作：**

- 通过 Node 文件 Fetcher 服务 `dist`，保持 `ASSETS.fetch()` 使用形状。
- 复用现有 `assetRouting.ts`、`assetHeaders.ts`：MIME 类型、SPA fallback、HTML 安全头、hashed asset immutable 缓存和 `sw.js` 再验证策略一致。
- `/assets/*` 路径防止 traversal；缺失构建分包必须为 404，不得回落成 index.html。
- 配置 `HOST`、`PORT`、可信代理和反向代理后的 HTTPS/Host 识别。
- 从可信 Node socket 获取客户端 IP；只有明确配置可信代理 CIDR 时才接受 `X-Forwarded-For` 等头。
- 重新审查 favicon/site metadata 抓取链路的 SSRF：DNS 解析、重定向、IPv4/IPv6 私网、loopback、link-local、Docker 内部域名及云元数据地址。
- 收到 SIGTERM/SIGINT 后停止接受请求、关闭 HTTP server、完成必要任务、checkpoint/关闭 SQLite。

**出口条件：** Node 浏览器 smoke 覆盖首页、管理路由、安装入口、PWA 和缺失资源；代理 IP 与 HTTPS 同源验证通过；SSRF 回归阻止容器内部网络探测。

### 阶段 5：Docker 镜像与 Compose

**工作：**

- 建立多阶段 Docker build：依赖安装、Vite 构建、Node 服务打包、最小运行镜像。
- 初始基础镜像选 Node 24 Debian slim；运行用户非 root，应用目录只读，只有 `/data` 持久化可写。
- 增加 `compose.yaml`、安全环境变量示例、`.dockerignore`、健康检查和 restart policy。
- 不把 `.env`、密钥、数据库、D1 导出、验证资料或本机配置复制进镜像。
- 使用独立业务 SQLite 与 KV SQLite 文件；首版明确不支持多个服务副本共用 SQLite 卷。
- 启动时校验目录可写、配置有效、数据库能打开；健康检查区分进程存活、存储可用和是否已安装。

环境变量建议：`HOST`、`PORT`、`SQLITE_PATH`、`KV_PATH`、`DIST_DIR`、`SESSION_TTL`、`SETUP_TOKEN`、`INIT_ADMIN_USER`、`INIT_ADMIN_PASSWORD`、`TRUST_PROXY`、`TRUST_PROXY_CIDRS`、`CACHE_MAX_ENTRIES`、`CACHE_MAX_BYTES`。密钥只能由部署环境注入，不得进入镜像层或 tracked example 的真实值。

**出口条件：** `docker compose up --build` 后健康检查成功，可完成首次安装、登录、CRUD 和重启持久化；镜像以非 root 运行并且只挂载数据卷写入。

### 阶段 6：数据迁移、备份与恢复

**工作：**

- 提供受控的 Cloudflare D1 SQL 导出 → SQLite 导入流程，保护导出文件和导入日志中的凭据、JWT secret、内部设置和图标正文。
- 不将前端 JSON 备份当作完整数据库迁移：聚合 API 不返回图标正文，用户备份也不包含内部认证设置或 KV 状态。
- 导入后验证 `PRAGMA integrity_check`、`foreign_key_check`、表/行数、schema version、data version、图标字段、安装状态和公开/私有 API 读数。
- 默认不迁移旧 KV；轮换 `jwt_secret` 使旧 JWT 与旧 icon access grant 失效，用户重新登录。
- 提供 SQLite 一致性备份和恢复操作。WAL 模式下不得对运行中的主 DB 文件做普通文件复制并宣称备份有效；使用 SQLite backup 能力或停止写入并 checkpoint 后备份。
- 记录切换写入冻结窗口和回滚点。Node 切换后新增写入不会自动回流 D1；回滚前必须迁回增量或明确接受回到旧快照。

**出口条件：** 至少完成 D1 导出文件导入的真实数据验证、备份/恢复往返、密钥轮换和登录状态失效验证；回滚步骤按书面流程演练。

### 阶段 7：跨运行时验证、文档与发布

**工作：**

- 保留并运行原 Cloudflare `npm run build`、L0 与 L1 Wrangler smoke。
- 新增 Node 运行时单测、Node smoke、Docker build smoke 和真实浏览器回归。
- 同一夹具在 Worker 与 Node 版本上比较公开数据、后台数据、错误包络、鉴权、导入、排序、图标隐私和缓存行为。
- 更新 README、部署/排障指南、架构参考、脚本说明和 CI。
- 发布记录明确 Node/Docker 的支持范围、单机单进程限制、SQLite 可移植性差异、迁移和回滚约束；不声称 EdgeOne 支持。

**出口条件：** 两个运行时各自通过对应 smoke；Docker 安装、迁移、备份恢复和回滚证据完成；安全与依赖扫描通过；Cloudflare 路径无回归。

## 5. 关键契约与验收矩阵

### 数据与事务

- D1 与 SQLite 对相同输入产生一致的 API 包络、行结果和 `data_version`。
- batch 中途失败时业务行、触发器副作用和版本更新全部回滚。
- `RETURNING`、`meta.changes`、外键、索引、触发器和旧 schema 修复行为有真实 SQLite 证据。
- 最大导入规模 2000 分类与 20000 书签不丢数据；记录 Node 延迟和事件循环影响。

### 认证与 KV

- 登录限流、撤销写入、TTL 到期、容器重启后读写均符合契约。
- 登出后旧 Token 仍被拒绝；KV 失败与未配置状态不伪装成功。
- 迁移密钥轮换后所有旧 JWT 和图标授权失败，管理员可正常重新登录。

### 缓存与隐私

- 公开 `/api/public/data?v=<data_version>` 可命中缓存；版本前进后旧响应不可冒充新响应。
- Bearer 认证响应不读写共享缓存。
- 私密对象、私密祖先下对象、未知 ID 的匿名图标响应遵守既有字节与头部边界。
- `private/no-store` 以及授权图标从不进入 Node 内存共享缓存。
- 缓存条目数、总字节和 TTL 均有界，重启仅清除缓存，不清除业务数据或 KV。

### 静态资源、网络与 Docker

- SPA 路由成功，缺失静态 chunk 为 404，路径穿越被拒绝。
- CSP、`no-transform`、HTML/asset/Service Worker Cache-Control 与 Worker 路径一致。
- 可信代理配置关闭时伪造转发头不改变客户端 IP；启用时仅信任配置的代理。
- SSRF 测试证明 Docker 网络不可被公开 API 用于访问 loopback、私网、link-local、Docker service 与云元数据地址。
- Docker 容器非 root，`/data` 重启持久；健康检查准确区分服务与安装状态。

## 6. 分支与长期升级策略

- `docker` 是 Node/Docker 长期维护分支；Cloudflare `develop` 仍是共享应用和 Cloudflare 部署基线。
- 新功能优先在 `develop` 的共享业务层实现并验证，再将 `develop` 更新合并进 `docker`，避免 Docker 分支长期落后于安全与业务修复。
- Node 运行时、Dockerfile、SQLite/KV/cache 适配和容器部署专属改动留在 `docker`。
- 若发现共享业务缺陷，不只在 Docker 适配器旁路修复：先让共享修复进入 `develop`，再合并 `develop` 到 `docker`。需要两边独立实现的运行时适配，再各自提交对应部分。
- 不把完整 `docker` 分支无审查地合并回 `develop`，避免 Node 专属依赖、配置和部署语义改变 Cloudflare Worker 的默认构建或自动部署。
- 分支同步使用可审查的普通 merge；不通过强推或历史重写维护长期分支。
- 当前 `docker` 分支为本地创建，尚未配置远端分支或推送；远端发布需单独授权。

## 7. 风险、取舍与待裁定项

1. **SQLite 驱动：** Node 24 `node:sqlite` 是 Release Candidate 且同步执行。阶段 0 决定是否接受；若延迟不合格，评估成熟驱动或异步适配，不预先双轨实现。
2. **单实例边界：** SQLite 适合单机单写入应用，不等同于 D1 的跨区域服务。首版明确限制，不用内存缓存或共享文件伪装多副本支持。
3. **反向代理信任：** 不可信 `X-Forwarded-For` 会绕过 IP 限流；必须显式配置可信代理。
4. **Node SSRF 面：** Worker 可达性假设在 Docker 不成立，需新增网络专项测试。
5. **缓存范围：** Node 进程缓存不跨进程、容器或重启。正确性必须来自数据库版本和响应契约，不依赖缓存成为事实源。
6. **安装凭据：** 首次安装的 `SETUP_TOKEN` 通过 secret 管理注入；安装完成后的移除/轮换方式与 Worker 保持文档一致。
7. **数据回滚：** D1 和 Docker SQLite 不做双写。迁移后的回滚需冻结写入和导出增量，不可承诺无损自动切回。

## 8. 官方运行时参考

- [Hono Node.js adapter](https://hono.dev/docs/getting-started/nodejs)
- [Node.js 24 SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

官方文档状态可能随 Node 补丁版本变化；阶段 0 必须以实际锁定的容器 Node 版本复核。