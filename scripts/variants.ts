// Ways of asking Jev for a move, for comparing in the tournament harness. "baseline" is what the live site uses.
import { askJev, buildJevRequest, LIVE_PROMPT, type JevDecision, type PromptOptions } from "../src/core/jev";
import { recall, type Memory } from "../src/core/memory";
import type { RunnerDeps } from "../src/core/runner";

const single = (opts: PromptOptions) => (key: string): RunnerDeps["jev"] => async (chess, recentSan) => {
  const { request, facts } = buildJevRequest(chess, recentSan, opts);
  return { decision: await askJev(key, request, facts), facts };
};

// With memory: lessons and/or opening records recalled before each move.
const remembering =
  (opts: PromptOptions, use: { history: boolean; openings: boolean }) =>
  (key: string, memory?: Memory): RunnerDeps["jev"] =>
  async (chess, recentSan) => {
    const r = memory ? await recall(memory, chess, recentSan) : { history: {}, openings: {} };
    const used = { history: use.history ? r.history : {}, openings: use.openings ? r.openings : {} };
    const { request, facts } = buildJevRequest(chess, recentSan, opts, used);
    return { decision: await askJev(key, request, facts), facts, recall: used };
  };

// Asks twice with the options in opposite orders and averages, to cancel out any bias from position in the list.
const twice = (opts: PromptOptions) => (key: string): RunnerDeps["jev"] => async (chess, recentSan) => {
  const a = buildJevRequest(chess, recentSan, opts);
  const b = buildJevRequest(chess, recentSan, { ...opts, reverse: true });
  const [da, db] = await Promise.all([askJev(key, a.request, a.facts), askJev(key, b.request, b.facts)]);
  const p = new Map<string, { san: string; uci: string; p: number }>();
  for (const o of [...da.options, ...db.options]) {
    const cur = p.get(o.san) ?? { san: o.san, uci: o.uci, p: 0 };
    cur.p += o.p / 2;
    p.set(o.san, cur);
  }
  const options = [...p.values()].sort((x, y) => y.p - x.p);
  const decision: JevDecision = {
    ...da,
    san: options[0]!.san,
    uci: options[0]!.uci,
    options,
    confidence: (da.confidence + db.confidence) / 2,
    resign: (da.resign + db.resign) / 2,
    inputTokens: da.inputTokens + db.inputTokens,
    latencyMs: Math.max(da.latencyMs, db.latencyMs),
  };
  return { decision, facts: a.facts };
};

export const VARIANTS: Record<string, (key: string, memory?: Memory) => RunnerDeps["jev"]> = {
  // The original plain facts, before the round one test.
  baseline: single({}),
  live: single(LIVE_PROMPT),
  net: single({ net: true }),
  grouped: single({ group: true, net: true }),
  twice: twice({}),
  lookahead: single({ ...LIVE_PROMPT, lookahead: true }),
  minimal: single({ ...LIVE_PROMPT, minimal: true }),
  "lookahead-minimal": single({ ...LIVE_PROMPT, lookahead: true, minimal: true }),
  history: remembering(LIVE_PROMPT, { history: true, openings: false }),
  openings: remembering(LIVE_PROMPT, { history: false, openings: true }),
  memory: remembering(LIVE_PROMPT, { history: true, openings: true }),
};
