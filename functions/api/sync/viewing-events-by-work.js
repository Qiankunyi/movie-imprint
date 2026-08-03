export async function onRequest(context) {
  const workId = new URL(context.request.url).searchParams.get("workId");
  if (!workId) return json(400, { error: "missing_workId" });
  const { results } = await context.env.DB.prepare(
    "SELECT data FROM store_entries WHERE store = ?"
  ).bind("viewingEvents").all();
  const events = results
    .map((row) => JSON.parse(row.data))
    .filter((e) => e.work_id === workId);
  return json(200, events);
}

function json(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
