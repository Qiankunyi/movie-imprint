/**
 * R6 补丁 4 · TMDB 配置诊断端点。
 *
 * 存在的理由：搜索面板只能告诉你"TMDB 没参与"，但分不清究竟是
 * ① 这一版代码根本没部署、② 环境变量没进 context.env、③ token 无效被 TMDB 拒绝。
 * 这三种情况的处理方式完全不同，靠猜会来回折腾好几轮。
 *
 * **安全红线：绝不回显 token 的任何部分，也不回显长度。**
 * 只回答"有没有读到"、"读到的是哪个变量名"、以及"拿它去请求 TMDB 会不会通"。
 *
 * 三个信号如何解读：
 *
 * | 现象 | 结论 |
 * |---|---|
 * | 这个端点本身 404 | 当前线上部署里没有 R6 补丁 4 的代码 —— 先重新部署 |
 * | `configured: false` | Function 跑起来了，但 `context.env` 里读不到变量 |
 * | `configured: true` + `probe.status: 401` | 变量读到了，但 token 无效或类型不对 |
 * | `configured: true` + `probe.ok: true` | 链路完全正常，搜不到就是召回问题 |
 *
 * 默认不打 TMDB（避免被当成免费探活接口刷）；加 `?probe=1` 才做一次真实请求。
 */
import { buildTmdbSearchRequest } from "../../../src/tmdb.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  const token = context.env.TMDB_ACCESS_TOKEN?.trim();
  const apiKey = context.env.TMDB_API_KEY?.trim();

  // 只报变量名，不报值。两个都配时以 v4 token 为准（和 search.js 的取值顺序一致）。
  const variable = token ? "TMDB_ACCESS_TOKEN" : apiKey ? "TMDB_API_KEY" : null;
  const configured = !!variable;

  const body = {
    configured,
    variable,
    language: context.env.TMDB_LANGUAGE?.trim() || "zh-CN",
    // 这两个和 TMDB 无关，但一起报出来能省一轮排查：
    // 说明 Function 确实在跑、以及访问密码与 D1 绑定的生效情况。
    runtime: {
      functions_deployed: true,
      access_password_enabled: !!context.env.ACCESS_PASSWORD?.trim(),
      d1_bound: !!context.env.DB
    },
    probe: { checked: false }
  };

  if (!configured || url.searchParams.get("probe") !== "1") {
    return jsonResponse(200, body);
  }

  // 真实打一次 TMDB，确认这个凭据是否被接受。
  // 用固定的英文查询词，避免把诊断结果和中文召回问题混在一起。
  try {
    const { url: apiUrl } = buildTmdbSearchRequest("Birdman", { language: body.language });
    const headers = { accept: "application/json" };
    let requestUrl = apiUrl;
    if (token) headers.authorization = `Bearer ${token}`;
    else requestUrl = `${apiUrl}&api_key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(requestUrl, { headers, signal: AbortSignal.timeout(6000) });
    let resultCount = null;
    if (upstream.ok) {
      const payload = await upstream.json().catch(() => null);
      resultCount = Array.isArray(payload?.results) ? payload.results.length : null;
    }
    body.probe = {
      checked: true,
      ok: upstream.ok,
      status: upstream.status,
      resultCount,
      // TMDB 的错误信息里不含凭据，可以安全透出——401 一般是 token 无效或用错类型
      hint: upstream.status === 401
        ? "TMDB 拒绝了这个凭据：v4 token 要填 TMDB_ACCESS_TOKEN，v3 key 要填 TMDB_API_KEY，别互相填错"
        : upstream.ok ? null : `TMDB 返回 ${upstream.status}`
    };
  } catch (error) {
    body.probe = { checked: true, ok: false, status: null, resultCount: null, hint: `请求异常：${error.message}` };
  }

  return jsonResponse(200, body);
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
