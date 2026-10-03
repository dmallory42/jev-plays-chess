// Plays Jev against Maia at a fixed rating, with the live game rules but no pacing.
// Usage: npx tsx scripts/tournament.ts --games 100 --elo 700 --concurrency 8 --variant baseline --out runs/baseline
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JEV_INPUT_PRICE } from "../src/core/jev";
import { maiaOpponentFrom } from "../src/core/maia-opponent";
import { MemoryMemory } from "../src/core/memory";
import { jevScore, tick } from "../src/core/runner";
import { MemoryStore } from "../src/core/store";
import { loadMaia } from "maia3-ts";
import { VARIANTS } from "./variants";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "100" },
    elo: { type: "string", default: "700" },
    concurrency: { type: "string", default: "8" },
    variant: { type: "string", default: "baseline" },
    out: { type: "string" },
  },
});
const games = Number(values.games);
const elo = Number(values.elo);
const concurrency = Math.min(Number(values.concurrency), games);
const variant = VARIANTS[values.variant!];
if (!variant) throw new Error(`Unknown variant ${values.variant}. Known: ${Object.keys(VARIANTS).join(", ")}`);
const out = values.out ?? `runs/${values.variant}-${elo}-${Date.now()}`;

const key = process.env.TYPESAFE_API_KEY ?? /TYPESAFE_API_KEY=(.+)/.exec(readFileSync(".env.server", "utf8"))?.[1];
if (!key) throw new Error("Set TYPESAFE_API_KEY or create .env.server");
const buf = readFileSync("web/public/maia3-5m.safetensors");
// One memory shared by every worker, so lessons from any game help all later games.
const memory = new MemoryMemory();
const jev = variant(key, memory);
const opponent = maiaOpponentFrom(loadMaia(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));

const stores: MemoryStore[] = [];
let finished = 0;
const started = Date.now();

// Each worker has its own store, so colours alternate within it and games never share state.
async function worker(target: number) {
  const store = new MemoryStore();
  stores.push(store);
  const deps = { store, jev, memory, opponent, pickOpponent: () => elo, budgetMs: 5 * 60_000, plyIntervalMs: 0, gameGapMs: 0, maxAheadMs: Number.MAX_SAFE_INTEGER };
  let done = 0;
  let failures = 0;
  while (done < target) {
    let r;
    try {
      r = await tick({ ...deps, budgetMs: 1 });
      failures = 0;
    } catch (e) {
      // An API outage pauses this worker instead of losing the whole run.
      if (++failures > 30) throw e;
      if (failures === 1) console.error(`\n${(e as Error).message.slice(0, 120)}; retrying`);
      await new Promise((res) => setTimeout(res, 10_000));
      continue;
    }
    if (r.gamesFinished) {
      done += r.gamesFinished;
      finished += r.gamesFinished;
      process.stdout.write(`\r${finished}/${games} games, ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
}

const shares = Array.from({ length: concurrency }, (_, i) => Math.floor(games / concurrency) + (i < games % concurrency ? 1 : 0));
await Promise.all(shares.map(worker));
process.stdout.write("\n");

const all = [];
let w = 0, d = 0, l = 0, resigned = 0, plies = 0, calls = 0, tokens = 0;
for (const store of stores) {
  const ladder = await store.getLadder();
  w += ladder.wins; d += ladder.draws; l += ladder.losses; calls += ladder.jevCalls; tokens += ladder.jevTokens;
  for (const g of await store.recentGames(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) {
    all.push({ game: g, plies: await store.getPlies(g.id) });
    plies += g.plies;
    if (g.termination === "resignation") resigned++;
  }
}
const n = w + d + l;
const score = (w + d / 2) / n;
// Performance rating against a fixed opponent, with a rough 95% interval from the score's standard error.
const perf = (s: number) => elo + 400 * Math.log10(Math.min(0.99, Math.max(0.01, s)) / (1 - Math.min(0.99, Math.max(0.01, s))));
const se = Math.sqrt((score * (1 - score)) / n);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/games.json`, JSON.stringify({ variant: values.variant, elo, games: all }));
console.log(`Variant ${values.variant} vs Maia ${elo}: W ${w} D ${d} L ${l}, score ${(score * 100).toFixed(1)}%`);
console.log(`Performance ${Math.round(perf(score))} (95% range ${Math.round(perf(score - 1.96 * se))} to ${Math.round(perf(score + 1.96 * se))})`);
// Learning shows up as a better score later in the run than earlier.
const byFinish = all.map((x) => x.game).sort((a, b) => (a.endedShowAt ?? 0) - (b.endedShowAt ?? 0));
const scoreOf = (gs: typeof byFinish) => gs.reduce((sum, g) => sum + jevScore(g.result!, g.jevColor), 0) / Math.max(1, gs.length);
const half = Math.floor(byFinish.length / 2);
console.log(`First half ${(scoreOf(byFinish.slice(0, half)) * 100).toFixed(1)}% (perf ${Math.round(perf(scoreOf(byFinish.slice(0, half))))}), second half ${(scoreOf(byFinish.slice(half)) * 100).toFixed(1)}% (perf ${Math.round(perf(scoreOf(byFinish.slice(half))))})`);
if (values.variant === "memory" || values.variant === "history") {
  const flagged = await memory.allPatterns(4, 8);
  console.log("Move kinds that most often went wrong:");
  for (const p of flagged) console.log(`  ${p.wrong}/${p.played}  ${p.text}`);
}
console.log(`${resigned} resignations, ${(plies / n / 2).toFixed(0)} moves per game, ${calls} Jev calls, $${(tokens * JEV_INPUT_PRICE).toFixed(2)}, ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`Saved to ${out}/games.json`);
