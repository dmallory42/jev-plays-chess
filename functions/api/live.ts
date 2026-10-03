import { liveView } from "../../src/core/views";
import { json, storeFor, type Env } from "./_shared";

export async function GET(request: Request, context: { env: Env }) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game");
  const after = Number(url.searchParams.get("after") ?? "-1");
  // Only well-formed viewer ids are recorded.
  const viewer = /^[a-z0-9]{8,40}$/.test(url.searchParams.get("v") ?? "") ? url.searchParams.get("v") : null;
  const store = await storeFor(context.env);
  return json(await liveView(store, Date.now(), game ? Number(game) : null, after, viewer));
}
