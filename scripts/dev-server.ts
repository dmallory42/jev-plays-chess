// Local API for the viewer: the Node adapter on an in-memory SQLite database.
// Usage: npx tsx scripts/dev-server.ts [--fake-jev] [--random-opponent]
import { Chess } from "chess.js";
import { existsSync, readFileSync } from "node:fs";
import { sqliteD1, startServer } from "../deploy/node/server";
import { moveFacts } from "../src/core/facts";
import type { JevDecision } from "../src/core/jev";
import type { RunnerDeps } from "../src/core/runner";

const key = process.env.TYPESAFE_API_KEY ?? (existsSync(".env.server") ? /TYPESAFE_API_KEY=(.+)/.exec(readFileSync(".env.server", "utf8"))?.[1] : undefined);
const fakeJev = process.argv.includes("--fake-jev") || !key;

const fake: RunnerDeps["jev"] = async (chess) => {
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

// Any legal move, for working on the viewer without the Maia weights.
const randomOpponent: RunnerDeps["opponent"] = async ({ fen }) => {
  const moves = new Chess(fen).moves({ verbose: true });
  const m = moves[Math.floor(Math.random() * moves.length)]!;
  return { uci: m.from + m.to + (m.promotion ?? ""), top: [] };
};

console.log(fakeJev ? "Jev: stand-in" : "Jev: real (spends TypeSafe credits)");
startServer({
  port: 8788,
  // Vite serves the viewer; this only needs to serve the Maia weights to the opponent.
  staticDir: "web/public",
  config: {
    db: sqliteD1(":memory:"),
    dialect: "sqlite",
    typesafeApiKey: key,
    jev: fakeJev ? fake : undefined,
    opponent: process.argv.includes("--random-opponent") ? randomOpponent : undefined,
  },
});
