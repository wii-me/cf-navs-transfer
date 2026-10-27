// 在页面里调用 /api/login 并把会话写进 localStorage（与前端 authSession 的存储键一致）。
// 该函数会被序列化后注入页面执行，必须自包含、不引用外部变量。
// chrome-regression、perf-audit 与两个图标实验脚本原先各自复制了一份（代码审查三轮第 35 项）。
export async function loginInPage(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.code !== 0) return { ok: false, status: response.status, body }
  localStorage.setItem('cf-navs.auth', JSON.stringify(body.data))
  return { ok: true, status: response.status, username: body.data.username, expires_at: body.data.expires_at }
}
