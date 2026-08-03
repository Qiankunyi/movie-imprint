export async function onRequest(context) {
  if (context.request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const { record, work } = await readJson(context.request);
  const stmt = context.env.DB.prepare(
    "INSERT OR REPLACE INTO store_entries (store, id, data) VALUES (?, ?, ?)"
  );
  await context.env.DB.batch([
    stmt.bind("works", work.id, JSON.stringify(work)),
    stmt.bind("records", record.id, JSON.stringify(record))
  ]);
  return json(200, { ok: true });
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
