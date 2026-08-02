import { listAiProviders } from "../../../src/ai-providers.js";

export async function onRequest(context) {
  return new Response(JSON.stringify(listAiProviders(context.env)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
