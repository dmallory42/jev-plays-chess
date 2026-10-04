// The whole API as one Web-standard fetch handler, so any host that speaks Request/Response can run it.
// Each adapter in deploy/ supplies the database, the Jev key and the static files.
import { moveFacts } from "../core/facts";
import { askJev, buildJevRequest, LIVE_PROMPT } from "../core/jev";
import { maiaOpponent } from "../core/maia-opponent";
import { FLAG_MIN_PLAYED, recall } from "../core/memory";
import { tick, type RunnerDeps } from "../core/runner";
import { SqlStore, type D1Like, type Dialect } from "../core/sql-store";
import { gameListView, gameView, liveView, openingRecordView, plyView, summaryView } from "../core/views";

export interface AppConfig {
  db: D1Like;
  dialect: Dialect;
  typesafeApiKey?: string;
  // Stand-ins for local development.
  jev?: RunnerDeps["jev"];
  opponent?: RunnerDeps["opponent"];
}

let ready: Promise<void> | null = null;

// One store per request; the schema check runs once per process or isolate.
async function storeFor(config: AppConfig) {
  const store = new SqlStore(config.db, config.dialect);
  ready ??= store.init().catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return store;
}

// Jev with its memory: before each move it's reminded of how moves like each option have gone before.
function jevFor(key: string | undefined, store: SqlStore): RunnerDeps["jev"] {
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  return async (chess, recentSan) => {
    const all = moveFacts(chess);
    const remembered = await recall(store, chess, recentSan, all);
    const { request, facts } = buildJevRequest(chess, recentSan, LIVE_PROMPT, remembered, all);
    return { decision: await askJev(key, request, facts), facts, recall: remembered };
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { "cache-control": "no-store", ...(init.headers ?? {}) } });

/** Handles /api/* requests. Returns null for any other path, for the adapter to serve as a static file. */
export async function handleApi(request: Request, config: AppConfig): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const route = url.pathname.slice("/api/".length).replace(/\/$/, "");
  const store = await storeFor(config);
  const now = Date.now();

  // Advances the ladder. Safe to call from anywhere: the lease allows one runner at a time and
  // pacing caps how far ahead of viewers it computes, so extra calls can't raise the Jev spend.
  if (route === "tick" && (request.method === "GET" || request.method === "POST")) {
    const result = await tick({
      store,
      memory: store,
      jev: config.jev ?? jevFor(config.typesafeApiKey, store),
      opponent: config.opponent ?? maiaOpponent(url.origin),
      budgetMs: 15_000,
      plyIntervalMs: 3_000,
      // Matches THINK_MS in web/src/main.ts, so Maia replies 3 seconds after Jev's piece moves.
      jevThinkMs: 2_200,
      gameGapMs: 12_000,
      maxAheadMs: 60_000,
    });
    return json(result);
  }
  if (request.method !== "GET") return json({ error: "method not allowed" }, { status: 405 });

  if (route === "live") {
    const game = url.searchParams.get("game");
    const after = Number(url.searchParams.get("after") ?? "-1");
    // Only well-formed viewer ids are recorded.
    const viewer = /^[a-z0-9]{8,40}$/.test(url.searchParams.get("v") ?? "") ? url.searchParams.get("v") : null;
    return json(await liveView(store, now, game ? Number(game) : null, after, viewer));
  }

  if (route === "games") return json(await summaryView(store, now));

  // Finished games, newest first, 20 at a time: ?before=<id> for the next page, ?colour=w|b and ?outcome=win|draw|loss to filter.
  if (route === "history") {
    const q = url.searchParams;
    const before = Number(q.get("before"));
    const colour = q.get("colour");
    const outcome = q.get("outcome");
    return json(
      await gameListView(store, now, {
        limit: 20,
        beforeId: Number.isInteger(before) && before > 0 ? before : undefined,
        colour: colour === "w" || colour === "b" ? colour : undefined,
        outcome: outcome === "win" || outcome === "draw" || outcome === "loss" ? outcome : undefined,
      }),
    );
  }

  // A finished game's full move list, for replays.
  const gameId = /^games\/(\d+)$/.exec(route)?.[1];
  if (gameId) {
    const game = await store.getGame(Number(gameId));
    if (!game || game.endedShowAt === null || game.endedShowAt > now) return json({ error: "not found" }, { status: 404 });
    const plies = await store.shownPlies(game.id, -1, now);
    // A finished game never changes, so browsers and the CDN can keep it.
    return json({ game: gameView(game), plies: plies.map(plyView) }, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
  }

  // What Jev has learned: the kinds of move that keep going wrong, and its record in each named opening.
  if (route === "memory") {
    const [patterns, openings] = await Promise.all([store.allPatterns(FLAG_MIN_PLAYED, 40), openingRecordView(store, now)]);
    return json({ patterns, openings }, { headers: { "cache-control": "public, max-age=60" } });
  }

  return json({ error: "not found" }, { status: 404 });
}
