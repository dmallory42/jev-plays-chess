// Local API for the viewer: the real runner on an in-memory store. Usage: npx tsx scripts/dev-server.ts [--fake-jev] [--random-opponent]
import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { moveFacts } from "../src/core/facts";
import { askJev, buildJevRequest, LIVE_PROMPT, type JevDecision } from "../src/core/jev";
import { tick, type RunnerDeps } from "../src/core/runner";
import { MemoryStore } from "../src/core/store";
import { gameView, liveView, plyView, summaryView } from "../src/core/views";

const store = new MemoryStore();
const fakeJev = process.argv.includes("--fake-jev");
const randomOpponent = process.argv.includes("--random-opponent");
const key = process.env.TYPESAFE_API_KEY ?? /TYPESAFE_API_KEY=(.+)/.exec(readFileSync(".env.server", "utf8"))?.[1];

const jev: RunnerDeps["jev"] = async (chess, recentSan) => {
  if (!fakeJev && key) {
    const { request, facts } = buildJevRequest(chess, recentSan, LIVE_PROMPT);
    return { decision: await askJev(key, request, facts), facts };
  }
  // Stand-in: prefers moves with the best material outcome.
  const facts = moveFacts(chess);
  const ranked = [...facts].sort((a, b) => b.netGain - a.netGain || Math.random() - 0.5);
  const decision: JevDecision = {
    san: ranked[0]!.san,
    uci: ranked[0]!.uci,
    confidence: 0.5,
    options: ranked.map((f, i) => ({ san: f.san, uci: f.uci, p: i === 0 ? 0.5 : i < 4 ? 0.5 / 3 : 0 })),
    resign: 0,
    inputTokens: 0,
    latencyMs: 5,
    model: "fake",
  };
  return { decision, facts };
};

async function makeOpponent(): Promise<RunnerDeps["opponent"]> {
  if (!randomOpponent) {
    try {
      const { loadMaia, maiaMove, maiaPolicy } = await import("maia3-ts");
      const buf = readFileSync("web/public/maia3-5m.safetensors");
      const model = loadMaia(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      console.log("Opponent: Maia-3");
      return async ({ fen, historyUci, elo, jevElo }) => {
        const { move, policy } = maiaMove(model, { fen, history: historyUci, eloSelf: elo, eloOppo: jevElo });
        const chess = new Chess(fen);
        const top = Object.entries(policy)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([uci, p]) => {
            const san = chess.move(uci).san;
            chess.undo();
            return { uci, san, p };
          });
        const { value } = maiaPolicy(model, { fen, history: historyUci, eloSelf: elo, eloOppo: jevElo });
        return { uci: move, top, value };
      };
    } catch (e) {
      console.log(`Maia unavailable (${(e as Error).message}), using random moves`);
    }
  }
  return async ({ fen }) => {
    const moves = new Chess(fen).moves({ verbose: true });
    const m = moves[Math.floor(Math.random() * moves.length)]!;
    return { uci: m.from + m.to + (m.promotion ?? ""), top: [] };
  };
}

const opponent = await makeOpponent();
const run = () => tick({ store, jev, opponent, budgetMs: 5_000, plyIntervalMs: 3_000, gameGapMs: 8_000, maxAheadMs: 30_000 }).catch((e) => console.error(e));
setInterval(run, 5_000);
void run();

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const now = Date.now();
  let body: unknown = { error: "not found" };
  let status = 200;
  if (url.pathname === "/api/live") {
    const game = url.searchParams.get("game");
    body = await liveView(store, now, game ? Number(game) : null, Number(url.searchParams.get("after") ?? "-1"), url.searchParams.get("v"));
  } else if (url.pathname === "/api/games") {
    body = await summaryView(store, now);
  } else if (url.pathname.startsWith("/api/games/")) {
    const g = await store.getGame(Number(url.pathname.split("/").at(-1)));
    body = g ? { game: gameView(g), plies: (await store.shownPlies(g.id, -1, now)).map(plyView) } : { error: "not found" };
  } else if (url.pathname === "/api/tick") {
    body = await run();
  } else status = 404;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(8788, () => console.log("API on http://127.0.0.1:8788"));
