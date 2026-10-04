import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { expectedScore, pickOpponentElo, updateRating } from "../src/core/elo";
import { moveFacts } from "../src/core/facts";
import type { JevDecision } from "../src/core/jev";
import { jevScore, MIN_RESIGN_PLY, tick, type RunnerDeps } from "../src/core/runner";
import { MemoryStore } from "../src/core/store";

// Deterministic stand-ins: "Jev" plays the first legal move, the opponent the last.
function deps(store: MemoryStore, clock: { t: number }, overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    store,
    now: () => clock.t,
    budgetMs: 20_000,
    plyIntervalMs: 3_000,
    gameGapMs: 10_000,
    maxAheadMs: 60_000,
    jev: async (chess: Chess) => {
      clock.t += 100;
      const facts = moveFacts(chess);
      const f = facts[0]!;
      const decision: JevDecision = { san: f.san, uci: f.uci, confidence: 1, options: facts.map((x, i) => ({ san: x.san, uci: x.uci, p: i === 0 ? 1 : 0 })), resign: 0, inputTokens: 1000, latencyMs: 100, model: "fake" };
      return { decision, facts };
    },
    opponent: async ({ fen }) => {
      clock.t += 100;
      const m = new Chess(fen).moves({ verbose: true }).at(-1)!;
      return { uci: m.from + m.to + (m.promotion ?? ""), top: [] };
    },
    ...overrides,
  };
}

describe("elo", () => {
  it("expects 50% against an equal opponent and moves the rating by K/2 on a win", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(updateRating(1000, 1000, 1, 0)).toBe(1020);
    expect(updateRating(1000, 1000, 0, 100)).toBe(990);
  });

  it("rounds and clamps the opponent", () => {
    expect(pickOpponentElo(1012)).toBe(1000);
    expect(pickOpponentElo(1013)).toBe(1025);
    expect(pickOpponentElo(100)).toBe(600);
  });

  it("scores results from Jev's side", () => {
    expect(jevScore("1-0", "w")).toBe(1);
    expect(jevScore("1-0", "b")).toBe(0);
    expect(jevScore("1/2-1/2", "b")).toBe(0.5);
  });
});

describe("tick", () => {
  it("leaves extra time after Jev's plies only", async () => {
    const store = new MemoryStore();
    const clock = { t: 1_000_000 };
    await store.saveLadder({ ...(await store.getLadder()), nextShowAt: clock.t });
    await tick(deps(store, clock, { jevThinkMs: 2_200 }));
    const [first, second, third] = await store.getPlies(1);
    expect(first!.side).toBe("jev");
    expect(second!.showAt - first!.showAt).toBe(5_200);
    expect(third!.showAt - second!.showAt).toBe(3_000);
  });

  it("paces plies for viewers and stops when far enough ahead", async () => {
    const store = new MemoryStore();
    const clock = { t: 1_000_000 };
    await store.saveLadder({ ...(await store.getLadder()), nextShowAt: clock.t });
    const r = await tick(deps(store, clock));
    // 60s of lookahead at one ply per 3s.
    expect(r.plies).toBe(21);
    const plies = await store.getPlies(1);
    expect(plies[1]!.showAt - plies[0]!.showAt).toBe(3_000);
    expect(plies[0]!.side).toBe("jev");
    expect((await tick(deps(store, clock))).skipped).toBe("ahead");
  });

  it("plays games to the end, updates the rating and alternates colours", async () => {
    const store = new MemoryStore();
    const clock = { t: 0 };
    const d = deps(store, clock, { maxAheadMs: Number.MAX_SAFE_INTEGER, budgetMs: 1_000 });
    let finished = 0;
    while (finished < 2) finished += (await tick(d)).gamesFinished;
    const games = await store.recentGames(10, Number.MAX_SAFE_INTEGER);
    expect(games).toHaveLength(2);
    expect(games.map((g) => g.jevColor).sort()).toEqual(["b", "w"]);
    const ladder = await store.getLadder();
    expect(ladder.games).toBe(2);
    expect(ladder.wins + ladder.draws + ladder.losses).toBe(2);
    expect(games[0]!.ratingAfter).toBe(ladder.rating);
    expect(ladder.jevCalls).toBeGreaterThan(0);
  });

  it("skips while another tick holds the lease", async () => {
    const store = new MemoryStore();
    await store.tryLease("other", 0, Date.now() + 60_000);
    expect((await tick(deps(store, { t: Date.now() }))).skipped).toBe("leased");
  });
});

describe("viewers", () => {
  it("counts pages that checked in within the window", async () => {
    const { liveView } = await import("../src/core/views");
    const store = new MemoryStore();
    await store.touchViewer("aaaaaaaa", 1_000);
    await liveView(store, 20_000, null, -1, "bbbbbbbb");
    expect((await liveView(store, 40_000, null, -1, null)).watching).toBe(1);
  });
});

describe("resignation", () => {
  const unlimited = { maxAheadMs: Number.MAX_SAFE_INTEGER, budgetMs: 1_000 };

  it("lets Jev resign after two confident readings in a row, not before move 10", async () => {
    const store = new MemoryStore();
    const clock = { t: 0 };
    const base = deps(store, clock, unlimited);
    const d: RunnerDeps = {
      ...base,
      jev: async (chess, recent) => {
        const r = await base.jev(chess, recent);
        return { ...r, decision: { ...r.decision, resign: 0.75 } };
      },
    };
    while ((await tick(d)).gamesFinished === 0);
    const [game] = await store.recentGames(1, Number.MAX_SAFE_INTEGER);
    expect(game!.termination).toBe("resignation");
    // Jev is White in the first game, so White resigned.
    expect(game!.result).toBe("0-1");
    expect(game!.plies).toBeGreaterThanOrEqual(MIN_RESIGN_PLY);
    expect(game!.plies).toBeLessThanOrEqual(MIN_RESIGN_PLY + 2);
  });

  it("lets the opponent resign from its own loss estimate", async () => {
    const store = new MemoryStore();
    const clock = { t: 0 };
    const base = deps(store, clock, unlimited);
    const d: RunnerDeps = { ...base, opponent: async (i) => ({ ...(await base.opponent(i)), value: { win: 0.02, draw: 0.03, loss: 0.95 } }) };
    while ((await tick(d)).gamesFinished === 0);
    const [game] = await store.recentGames(1, Number.MAX_SAFE_INTEGER);
    expect(game!.termination).toBe("resignation");
    expect(game!.result).toBe("1-0");
    expect((await store.getLadder()).wins).toBe(1);
  });

  it("does not resign on a single high reading", async () => {
    const store = new MemoryStore();
    const clock = { t: 0 };
    const base = deps(store, clock, unlimited);
    let turn = 0;
    const d: RunnerDeps = {
      ...base,
      jev: async (chess, recent) => {
        const r = await base.jev(chess, recent);
        return { ...r, decision: { ...r.decision, resign: turn++ % 2 ? 0.75 : 0.1 } };
      },
    };
    while ((await tick(d)).gamesFinished === 0);
    const [game] = await store.recentGames(1, Number.MAX_SAFE_INTEGER);
    expect(game!.termination).not.toBe("resignation");
  });
});

describe("memory", () => {
  it("learns from every finished game exactly once, including ones played before memory existed", async () => {
    const { MemoryMemory } = await import("../src/core/memory");
    const store = new MemoryStore();
    const clock = { t: 0 };
    const base = deps(store, clock, { maxAheadMs: Number.MAX_SAFE_INTEGER, budgetMs: 1_000 });
    let finished = 0;
    while (finished < 3) finished += (await tick(base)).gamesFinished;
    const memory = new MemoryMemory();
    // One game is learned per tick.
    for (let i = 0; i < 3; i++) await tick({ ...base, memory, budgetMs: 0 });
    expect((await store.getLadder()).memoryUpTo).toBe(3);
    const before = JSON.stringify(await memory.allOpenings(1, 100));
    await tick({ ...base, memory, budgetMs: 0 });
    expect(JSON.stringify(await memory.allOpenings(1, 100))).toBe(before);
  }, 60_000);
});
