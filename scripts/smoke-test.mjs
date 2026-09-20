// CF-Navs API 冒烟测试：对本地 wrangler dev 实例跑一轮端到端接口验证。
// 用法：node scripts/smoke-test.mjs  （需先 npm run dev 并完成本地 D1 初始化）

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const USER = process.env.ADMIN_USER || 'admin'
const PASS = process.env.ADMIN_PASS || 'replace-with-a-local-dev-password'
const SETUP_TOKEN = process.env.SETUP_TOKEN || ''

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function call(path, { method = 'GET', token, body, headers: extraHeaders } = {}) {
  const headers = { accept: 'application/json', ...extraHeaders }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

function section(title) {
  console.log(`\n# ${title}`)
}

async function main() {
  console.log(`CF-Navs 冒烟测试 → ${BASE}\n`)

  // 1. health
  section('健康检查')
  {
    const r = await call('/api/health')
    check('GET /api/health code=0', r.json?.code === 0, JSON.stringify(r.json))
    check('health status=ok', r.json?.data?.status === 'ok')
  }

  // 2. config
  section('公开配置')
  {
    const r = await call('/api/config')
    check('GET /api/config code=0', r.json?.code === 0)
    check('config 含 site_title', typeof r.json?.data?.site_title === 'string')
    check('config 含 public_mode', typeof r.json?.data?.public_mode === 'boolean')
  }

  // 3. 错误登录
  section('登录鉴权')
  {
    const r = await call('/api/login', { method: 'POST', body: { username: USER, password: 'wrong-password' } })
    check('错误密码登录被拒绝', r.json?.code !== 0, `code=${r.json?.code}`)
  }

  // 4. 正确登录
  let token = ''
  {
    const r = await call('/api/login', { method: 'POST', body: { username: USER, password: PASS } })
    check('正确登录 code=0', r.json?.code === 0, JSON.stringify(r.json))
    check('返回 token', typeof r.json?.data?.token === 'string' && r.json.data.token.length > 0)
    check('返回 expires_at', typeof r.json?.data?.expires_at === 'number')
    token = r.json?.data?.token || ''
  }
  if (!token) {
    console.log('\n无法获取 token，后续鉴权测试中止。')
    return finish()
  }

  // 5. me
  {
    const r = await call('/api/me', { token })
    check('GET /api/me 带 token code=0', r.json?.code === 0)
    check('me.username 匹配', r.json?.data?.username === USER, JSON.stringify(r.json?.data))
  }
  {
    const r = await call('/api/me')
    check('GET /api/me 无 token → 401', r.status === 401, `status=${r.status}`)
    check('me 无 token code=1001', r.json?.code === 1001, `code=${r.json?.code}`)
  }
  {
    const r = await call('/api/me', { token: 'invalid-token-xyz' })
    check('GET /api/me 无效 token → 401', r.status === 401, `status=${r.status}`)
  }

  // 6. 分类 CRUD + sort
  section('分类 CRUD 与排序')
  let catA, catB
  {
    const r = await call('/api/categories', { token })
    check('初始分类列表为空', Array.isArray(r.json?.data) && r.json.data.length === 0, `len=${r.json?.data?.length}`)
  }
  {
    const r = await call('/api/categories', { method: 'POST', token, body: { title: '常用工具', icon: '🔧' } })
    check('创建分类 A code=0', r.json?.code === 0, JSON.stringify(r.json))
    catA = r.json?.data
    check('分类 A 有 id', typeof catA?.id === 'number')
  }
  {
    const r = await call('/api/categories', { method: 'POST', token, body: { title: '学习资料' } })
    catB = r.json?.data
    check('创建分类 B code=0', r.json?.code === 0)
  }
  {
    const r = await call('/api/categories', { token })
    check('分类列表含 2 项', r.json?.data?.length === 2)
  }
  {
    const r = await call(`/api/categories/${catA.id}`, { method: 'PUT', token, body: { title: '常用工具(改)', icon: '🛠️' } })
    check('更新分类 A code=0', r.json?.code === 0)
    check('更新后标题生效', r.json?.data?.title === '常用工具(改)', r.json?.data?.title)
  }
  {
    // 顶层分类排序：PR #7 起 /api/categories/sort 按 CategorySortReq 要求 parent_id，
    // 顶层传 null（`worker/routes/categories.ts` sort 路由）。
    const r = await call('/api/categories/sort', {
      method: 'POST',
      token,
      body: { parent_id: null, ids: [catB.id, catA.id] },
    })
    check('分类排序 code=0', r.json?.code === 0, JSON.stringify(r.json))
    const list = (await call('/api/categories', { token })).json?.data || []
    check('排序后 B 在前', list[0]?.id === catB.id, `first=${list[0]?.id} expect=${catB.id}`)
  }

  // 7. 书签 CRUD + sort
  section('书签 CRUD 与排序')
  let bm1, bm2
  {
    const r = await call('/api/bookmarks', { method: 'POST', token, body: { category_id: catA.id, title: 'GitHub', url: 'https://github.com', icon: '', description: '代码托管', open_method: 1 } })
    check('创建书签1 code=0', r.json?.code === 0, JSON.stringify(r.json))
    bm1 = r.json?.data
  }
  {
    const r = await call('/api/bookmarks', { method: 'POST', token, body: { category_id: catA.id, title: 'MDN', url: 'https://developer.mozilla.org', open_method: 2 } })
    bm2 = r.json?.data
    check('创建书签2 code=0', r.json?.code === 0)
    check('open_method=2 持久化', bm2?.open_method === 2, `om=${bm2?.open_method}`)
  }
  {
    const r = await call(`/api/bookmarks/${bm1.id}`, { method: 'PUT', token, body: { category_id: catA.id, title: 'GitHub(改)', url: 'https://github.com', open_method: 1 } })
    check('更新书签1 code=0', r.json?.code === 0)
    check('书签标题更新', r.json?.data?.title === 'GitHub(改)')
  }
  {
    const r = await call('/api/bookmarks/sort', { method: 'POST', token, body: { ids: [bm2.id, bm1.id] } })
    check('书签排序 code=0', r.json?.code === 0)
    const list = (await call('/api/bookmarks', { token })).json?.data || []
    check('排序后 bm2 在前', list[0]?.id === bm2.id, `first=${list[0]?.id}`)
  }

  // 8. 设置（含 background / theme / search_engine）
  section('设置读写（背景/主题/搜索引擎）')
  {
    const r = await call('/api/settings', { token })
    check('GET /api/settings code=0', r.json?.code === 0)
    const s = r.json?.data
    check('默认含 background 对象', s?.background && typeof s.background.type === 'string')
    check('默认含 search_engine.engines', Array.isArray(s?.search_engine?.engines) && s.search_engine.engines.length >= 2)
  }
  {
    const patch = {
      site_title: '我的导航',
      theme: 'dark',
      background: { type: 'image', value: 'https://img.example.com/bg.jpg', blur: 12, mask: 0.45 },
      search_engine: {
        current: 'DuckDuckGo',
        engines: [
          { name: 'DuckDuckGo', icon: '', url_template: 'https://duckduckgo.com/?q={q}' },
          { name: 'Google', icon: '', url_template: 'https://www.google.com/search?q={q}' },
        ],
      },
    }
    const r = await call('/api/settings', { method: 'PUT', token, body: patch })
    check('PUT /api/settings code=0', r.json?.code === 0, JSON.stringify(r.json))
    const s = r.json?.data
    check('site_title 已更新', s?.site_title === '我的导航')
    check('theme=dark 已更新', s?.theme === 'dark')
    check('background.type=image', s?.background?.type === 'image')
    check('background.blur=12', s?.background?.blur === 12)
    check('background.mask=0.45', s?.background?.mask === 0.45)
    check('search_engine.current=DuckDuckGo', s?.search_engine?.current === 'DuckDuckGo')
    check('search_engine 引擎数=2', s?.search_engine?.engines?.length === 2)
  }
  {
    // 非法 theme 应被拒绝
    const r = await call('/api/settings', { method: 'PUT', token, body: { theme: 'rainbow' } })
    check('非法 theme 被拒绝(code=1002)', r.json?.code === 1002, `code=${r.json?.code}`)
  }
  {
    // 非法 background.type 应被拒绝
    const r = await call('/api/settings', { method: 'PUT', token, body: { background: { type: 'video' } } })
    check('非法 background.type 被拒绝', r.json?.code === 1002, `code=${r.json?.code}`)
  }

  // 9. public/data（公开模式开）
  section('公开数据聚合')
  {
    const r = await call('/api/public/data')
    check('GET /api/public/data 未登录可读(公开模式)', r.json?.code === 0, `code=${r.json?.code}`)
    const d = r.json?.data
    check('public/data 含 categories', Array.isArray(d?.categories))
    check('public/data 含 bookmarks', Array.isArray(d?.bookmarks))
    check('public settings 不含 admin_password', d && d.settings && !('admin_password' in d.settings))
    check('public settings 不含 public_mode', d && d.settings && !('public_mode' in d.settings))
    check('public settings 含 search_engine', !!d?.settings?.search_engine)
  }

  // 10. 公开模式关闭 → 未登录被拒
  section('公开模式开关')
  {
    await call('/api/settings', { method: 'PUT', token, body: { public_mode: false } })
    const anon = await call('/api/public/data')
    check('public_mode=false 未登录被拒(code=1005)', anon.json?.code === 1005, `code=${anon.json?.code}`)
    const authed = await call('/api/public/data', { token })
    check('public_mode=false 带 token 可读', authed.json?.code === 0)
    // 恢复
    const back = await call('/api/settings', { method: 'PUT', token, body: { public_mode: true } })
    check('恢复 public_mode=true', back.json?.data?.public_mode === true)
  }

  // 11. 删除级联
  section('删除与级联')
  {
    // 删除分类 A（其下有 bm1,bm2）→ 书签应一并删除
    const del = await call(`/api/categories/${catA.id}`, { method: 'DELETE', token })
    check('删除分类 A code=0', del.json?.code === 0)
    const bms = (await call('/api/bookmarks', { token })).json?.data || []
    const leftover = bms.filter((b) => b.category_id === catA.id)
    check('分类下书签被级联删除', leftover.length === 0, `leftover=${leftover.length}`)
    const cats = (await call('/api/categories', { token })).json?.data || []
    check('分类 A 已删除', !cats.some((c) => c.id === catA.id))
  }
  {
    // 删除剩余书签（catB 下应无书签了，再建一个删之）
    const created = (await call('/api/bookmarks', { method: 'POST', token, body: { category_id: catB.id, title: '临时', url: 'https://example.com' } })).json?.data
    const del = await call(`/api/bookmarks/${created.id}`, { method: 'DELETE', token })
    check('删除单个书签 code=0', del.json?.code === 0)
    const bms = (await call('/api/bookmarks', { token })).json?.data || []
    check('书签确实被删除', !bms.some((b) => b.id === created.id))
  }

  // 12. favicon（容忍外网失败）
  section('favicon 获取（容忍外网受限）')
  {
    try {
      const r = await call('/api/fetch-favicon?url=' + encodeURIComponent('https://github.com'), { token })
      if (r.json?.code === 0 && typeof r.json?.data?.icon === 'string') {
        check('fetch-favicon 返回图标 URL', true)
        console.log(`    icon = ${r.json.data.icon}`)
      } else {
        console.log(`    (跳过断言) favicon 返回 code=${r.json?.code}（沙箱外网可能受限）`)
      }
    } catch (e) {
      console.log(`    (跳过断言) favicon 请求异常：${e.message}`)
    }
  }

  // 12.1 站点名称解析（容忍外网失败，但鉴权必须成立）
  section('站点名称解析 /api/fetch-site-meta')
  {
    const anon = await call('/api/fetch-site-meta?url=' + encodeURIComponent('https://github.com'))
    check('fetch-site-meta 未登录被拒绝', anon.status === 401 || anon.json?.code === 1001)

    const bad = await call('/api/fetch-site-meta?url=' + encodeURIComponent('ftp://example.com'), { token })
    check('fetch-site-meta 拒绝非 http(s) 地址', bad.json?.code === 1002)

    try {
      const r = await call('/api/fetch-site-meta?url=' + encodeURIComponent('https://github.com'), { token })
      if (r.json?.code === 0 && typeof r.json?.data?.title === 'string') {
        // 接口契约是永不失败：解析不出来也要给出域名兜底
        check('fetch-site-meta 返回非空站点名称', r.json.data.title.length > 0)
        console.log(`    title = ${r.json.data.title}`)
      } else {
        console.log(`    (跳过断言) fetch-site-meta 返回 code=${r.json?.code}（沙箱外网可能受限）`)
      }
    } catch (e) {
      console.log(`    (跳过断言) fetch-site-meta 请求异常：${e.message}`)
    }
  }

  // 13. 数据导入（覆盖式）
  section('数据导入 /api/import')
  {
    // 合法导入：2 分类 + 2 书签 + 设置
    const payload = {
      categories: [
        { id: 101, title: '导入分类A', icon: '', sort: 0, created_at: Date.now() },
        { id: 102, title: '导入分类B', icon: '', sort: 1, created_at: Date.now() },
      ],
      bookmarks: [
        { id: 201, category_id: 101, title: '导入书签1', url: 'https://a.example.com', icon: '', description: '', open_method: 1, sort: 0, created_at: Date.now() },
        { id: 202, category_id: 102, title: '导入书签2', url: 'https://b.example.com', icon: '', description: '', open_method: 2, sort: 0, created_at: Date.now() },
      ],
      settings: { site_title: '导入后的标题' },
    }
    const r = await call('/api/import', { method: 'POST', token, body: payload })
    check('合法导入 code=0', r.json?.code === 0, JSON.stringify(r.json))
    check('导入返回 2 分类', r.json?.data?.categories === 2, `got=${r.json?.data?.categories}`)
    check('导入返回 2 书签', r.json?.data?.bookmarks === 2)

    const cats = (await call('/api/categories', { token })).json?.data || []
    const bms = (await call('/api/bookmarks', { token })).json?.data || []
    check('导入后分类被覆盖为 2 个', cats.length === 2, `len=${cats.length}`)
    check('导入后书签被覆盖为 2 个', bms.length === 2)
    // 导入按 remapImportRecords 从 1 起重编号（root 先于 child），并把书签的
    // category_id 重绑到新分类 id；原始 id 不保留，这是既有设计而非缺陷。
    const sortedCatIds = cats.map((c) => c.id).sort((a, b) => a - b)
    check('导入分类按 remap 从 1 起重编号', sortedCatIds.join(',') === '1,2', `ids=${sortedCatIds.join(',')}`)
    check('导入未保留原始分类 id', !cats.some((c) => c.id === 101 || c.id === 102), `ids=${sortedCatIds.join(',')}`)
    const catTitleById = new Map(cats.map((c) => [c.id, c.title]))
    const bmA = bms.find((b) => b.title === '导入书签1')
    const bmB = bms.find((b) => b.title === '导入书签2')
    check(
      '书签 category_id 重绑到正确分类',
      catTitleById.get(bmA?.category_id) === '导入分类A' && catTitleById.get(bmB?.category_id) === '导入分类B',
      `bm1→${catTitleById.get(bmA?.category_id)} bm2→${catTitleById.get(bmB?.category_id)}`,
    )
    const s = (await call('/api/settings', { token })).json?.data
    check('导入应用了 settings.site_title', s?.site_title === '导入后的标题', s?.site_title)
  }
  {
    // 非法导入：书签引用不存在的分类 → 拒绝
    const bad = {
      categories: [{ id: 1, title: 'X', icon: '', sort: 0, created_at: Date.now() }],
      bookmarks: [{ id: 1, category_id: 999, title: 'Y', url: 'https://y.example.com', icon: '', description: '', open_method: 1, sort: 0, created_at: Date.now() }],
    }
    const r = await call('/api/import', { method: 'POST', token, body: bad })
    check('引用缺失分类的导入被拒绝(1002)', r.json?.code === 1002, `code=${r.json?.code}`)
  }
  {
    // 非法导入：缺少 categories 数组 → 拒绝
    const r = await call('/api/import', { method: 'POST', token, body: { bookmarks: [] } })
    check('缺少 categories 的导入被拒绝', r.json?.code === 1002, `code=${r.json?.code}`)
  }
  {
    // 未授权导入 → 401
    const r = await call('/api/import', { method: 'POST', body: { categories: [], bookmarks: [] } })
    check('未登录导入 → 401', r.status === 401, `status=${r.status}`)
  }

  // 14. 登出
  section('登出')
  {
    const r = await call('/api/logout', { method: 'POST', token })
    check('登出 code=0', r.json?.code === 0)
    const after = await call('/api/me', { token })
    check('登出后 token 失效 → 401', after.status === 401, `status=${after.status}`)
  }

  // 15. 密码恢复（放最后：会重置密码并轮换 JWT secret，作废全部会话）
  section('密码恢复 /api/recover')
  if (!SETUP_TOKEN) {
    check('SETUP_TOKEN 未配置，跳过恢复场景', true, 'skipped')
  } else {
    const NEW_PASS = 'recovNew1'
    {
      const r = await call('/api/recover', { method: 'POST', body: { password: NEW_PASS }, headers: { 'X-Setup-Token': 'wrong-token' } })
      check('恢复错误令牌 → 401', r.status === 401, `status=${r.status}`)
    }
    {
      const r = await call('/api/recover', { method: 'POST', body: { password: NEW_PASS } })
      check('恢复缺令牌头 → 401', r.status === 401, `status=${r.status}`)
    }
    {
      const r = await call('/api/recover', { method: 'POST', body: { password: 'short1' }, headers: { 'X-Setup-Token': SETUP_TOKEN } })
      check('恢复弱密码 → 1002', r.json?.code === 1002, `code=${r.json?.code}`)
    }
    {
      const r = await call('/api/recover', { method: 'POST', body: { password: NEW_PASS }, headers: { 'X-Setup-Token': SETUP_TOKEN } })
      check('恢复成功 code=0', r.json?.code === 0, JSON.stringify(r.json))
      check('恢复返回原用户名', r.json?.data?.username === USER, `u=${r.json?.data?.username}`)
      check('恢复返回可用 token', typeof r.json?.data?.token === 'string' && r.json.data.token.length > 0)
    }
    {
      const r = await call('/api/login', { method: 'POST', body: { username: USER, password: NEW_PASS } })
      check('新密码可登录 code=0', r.json?.code === 0, JSON.stringify(r.json))
    }
    {
      const r = await call('/api/login', { method: 'POST', body: { username: USER, password: PASS } })
      check('旧密码登录被拒绝', r.json?.code !== 0, `code=${r.json?.code}`)
    }
  }

  finish()
}

function finish() {
  console.log(`\n================ 结果 ================`)
  console.log(`通过 ${pass} / ${pass + fail}`)
  if (failures.length) {
    console.log('失败项：')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  } else {
    console.log('全部通过 ✅')
    process.exit(0)
  }
}

main().catch((e) => {
  console.error('测试运行异常：', e)
  process.exit(2)
})
