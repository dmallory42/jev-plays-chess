import { maiaOpponent } from "../../src/core/maia-opponent";
import { tick } from "../../src/core/runner";
import { jevFor, json, storeFor, type Env } from "./_shared";

// Advances the ladder. Safe to call from anywhere: the lease allows one runner at a time and
// pacing caps how far ahead of viewers it computes, so extra calls can't raise the Jev spend.
async function run(request: Request, env: Env) {
  const store = await storeFor(env);
  const result = await tick({
    store,
    memory: store,
    jev: jevFor(env, store),
    opponent: maiaOpponent(new URL(request.url).origin),
    budgetMs: 15_000,
    plyIntervalMs: 3_000,
    gameGapMs: 12_000,
    maxAheadMs: 60_000,
  });
  return json(result);
}

type Ctx = { env: Env };
export const GET = (request: Request, context: Ctx) => run(request, context.env);
export const POST = (request: Request, context: Ctx) => run(request, context.env);
