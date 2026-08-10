export async function onRequest(context) {
  const { store } = context.params;
  const ALLOWED = ["records", "works", "drafts", "meta", "viewingEvents", "series", "collections", "externalPublications"];
  if (!ALLOWED.includes(store)) return json(400, { error: "unknown_store" });

  if (context.request.method === "GET") {
    const { results } = await context.env.DB.prepare(
      "SELECT data FROM store_entries WHERE store = ?"
    ).bind(store).all();
    return json(200, results.map((row) => JSON.parse(row.data)));
  }

  if (context.request.method === "POST") {
    // 批量写入（用于 putViewingEvents）
    const items = await readJson(context.request);
    if (!Array.isArray(items)) return json(400, { error: "expected_array" });
    const stmt = context.env.DB.prepare(
      "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
    );
    await context.env.DB.batch(items.map((item) => stmt.bind(store, item.id, JSON.stringify(item))));
    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" });
}

function json(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function readJson(request) {
  const text = await request.text();
  return JSON.parse(text || "{}");
}
