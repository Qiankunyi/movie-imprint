export async function onRequest(context) {
  if (!context.env.DB) {
    return json(500, { ok: false, error: "D1 binding 未配置，请在 Cloudflare Pages 设置里添加 DB binding 后重新部署" });
  }
  try {
    await context.env.DB.prepare("SELECT 1 AS ok").run();
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
