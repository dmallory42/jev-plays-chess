import { gameView, plyView } from "../../../src/core/views";
import { json, storeFor, type Env } from "../_shared";

// A finished game's full move list, for replays.
export async function GET(_request: Request, context: { env: Env; params: Record<string, string> }) {
  const store = await storeFor(context.env);
  const now = Date.now();
  const game = await store.getGame(Number(context.params.id));
  if (!game || game.endedShowAt === null || game.endedShowAt > now) return json({ error: "not found" }, { status: 404 });
  const plies = await store.shownPlies(game.id, -1, now);
  // A finished game never changes, so browsers and the CDN can keep it.
  return json({ game: gameView(game), plies: plies.map(plyView) }, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
}
