import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../deploy/node/server";
import { SqlStore } from "../src/core/sql-store";
import { MemoryStore, type Result } from "../src/core/store";
import { gameListView } from "../src/core/views";

const stores = [
  ["memory store", async () => new MemoryStore()],
  [
    "SQLite store",
    async () => {
      const s = new SqlStore(sqliteD1(":memory:"), "sqlite");
      await s.init();
      return s;
    },
  ],
] as const;

async function play(store: MemoryStore | SqlStore, jevColor: "w" | "b", result: Result, sans = "e4 e5 Nf3 Nc6 Bb5") {
  const id = await store.createGame({ jevColor, oppElo: 900, ratingBefore: 900, ratingAfter: 905, result, termination: "checkmate", plies: 5, startedAt: 0, endedShowAt: 1 });
  let ply = 0;
  for (const san of sans.split(" ")) await store.addPly({ gameId: id, ply: ply++, side: "jev", san, uci: "", fen: "", showAt: 0, data: {} });
  return id;
}

for (const [label, make] of stores) {
  describe(`gameListView (${label})`, () => {
    it("filters by Jev's outcome and colour, newest first", async () => {
      const store = await make();
      await play(store, "w", "1-0"); // 1: win as White
      await play(store, "b", "1-0"); // 2: loss as Black
      await play(store, "w", "1/2-1/2"); // 3: draw as White
      await play(store, "b", "0-1"); // 4: win as Black
      const ids = async (f: object) => (await gameListView(store, 10, { limit: 20, ...f })).games.map((g) => g.id);
      expect(await ids({})).toEqual([4, 3, 2, 1]);
      expect(await ids({ outcome: "win" })).toEqual([4, 1]);
      expect(await ids({ outcome: "loss" })).toEqual([2]);
      expect(await ids({ outcome: "draw" })).toEqual([3]);
      expect(await ids({ colour: "b" })).toEqual([4, 2]);
    });

    it("pages with a before id and says when older games remain", async () => {
      const store = await make();
      for (let i = 0; i < 5; i++) await play(store, "w", "1-0");
      const first = await gameListView(store, 10, { limit: 2 });
      expect([first.games.map((g) => g.id), first.more]).toEqual([[5, 4], true]);
      const last = await gameListView(store, 10, { limit: 2, beforeId: 2 });
      expect([last.games.map((g) => g.id), last.more]).toEqual([[1], false]);
    });

    it("names each game's opening", async () => {
      const store = await make();
      await play(store, "w", "1-0", "e4 e5 Nf3 Nc6 Bb5 a6");
      await play(store, "w", "1-0", "a3");
      const { games } = await gameListView(store, 10, { limit: 20 });
      expect(games.map((g) => g.opening)).toEqual([
        { eco: "A00", name: "Anderssen's Opening" },
        { eco: "C70", name: "Ruy Lopez: Morphy Defense" },
      ]);
    });
  });
}
