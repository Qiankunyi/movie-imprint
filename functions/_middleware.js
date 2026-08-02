/**
 * API 访问密码中间件
 *
 * 如果 Cloudflare 环境变量 ACCESS_PASSWORD 未配置，所有请求直接放行。
 * 如果已配置，检查请求的 Authorization: Bearer <password> 头。
 * 图片请求（/api/bangumi/image）同时支持 ?token= 查询参数，
 * 因为壁纸图片以 URL 形式嵌入 CSS，无法携带请求头。
 */
export async function onRequest(context) {
  const password = context.env.ACCESS_PASSWORD?.trim();

  // 未配置密码 → 直接放行
  if (!password) return context.next();

  const url = new URL(context.request.url);
  const authHeader = context.request.headers.get("authorization") || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // 图片请求允许通过 ?token= 传递密码
  const tokenFromQuery = url.searchParams.get("token") || "";
  const token = tokenFromHeader || tokenFromQuery;

  if (token !== password) {
    return new Response(
      JSON.stringify({ error: "unauthorized", message: "需要访问密码" }),
      {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "www-authenticate": 'Bearer realm="电影印记"',
          "cache-control": "no-store"
        }
      }
    );
  }

  return context.next();
}
