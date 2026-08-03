export async function onRequest(context) {
  if (context.request.method !== "POST") return json(405, { error: "method_not_allowed" });
  await context.env.DB.prepare("DELETE FROM store_entries").run();
  return json(200, { ok: true });
}

function json(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
