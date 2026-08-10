export async function onRequest(context) {
  const { store, id } = context.params;
  const ALLOWED = ["records", "works", "drafts", "meta", "viewingEvents", "series", "collections", "externalPublications"];
  if (!ALLOWED.includes(store)) return json(400, { error: "unknown_store" });

  if (context.request.method === "GET") {
    const row = await context.env.DB.prepare(
      "SELECT data FROM store_entries WHERE store = ? AND id = ?"
    ).bind(store, id).first();
    return row ? json(200, JSON.parse(row.data)) : json(404, null);
  }

  if (context.request.method === "PUT") {
    const value = await readJson(context.request);
    await context.env.DB.prepare(
      "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
    ).bind(store, id, JSON.stringify(value)).run();
    return json(200, { ok: true });
  }

  if (context.request.method === "DELETE") {
    await context.env.DB.prepare(
      "DELETE FROM store_entries WHERE store = ? AND id = ?"
    ).bind(store, id).run();
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
