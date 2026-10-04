import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../deploy/node/server";
import { classifyOpening } from "../src/core/openings";
import { SqlStore } from "../src/core/sql-store";
import type { GameRow, Result } from "../src/core/store";
import { MemoryStore } from "../src/core/store";
import { openingRecordView } from "../src/core/views";

const line = (s: string) => s.split(" ");

describe("classifyOpening", () => {
  it("names the deepest position the game reached", () => {
    expect(classifyOpening(line("e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3"))).toEqual({
      eco: "B90",
      name: "Sicilian Defense: Najdorf Variation, English Attack",
      family: "Sicilian Defense",
    });
  });

  it("keeps the last name when the game leaves the book", () => {
    expect(classifyOpening(line("e4 e5 Nf3 Nc6 Bb5 h5 h4"))?.name).toBe("Ruy Lopez");
  });

  it("gives transposed move orders the same name", () => {
    expect(classifyOpening(line("Nf3 d5 d4"))).toEqual(classifyOpening(line("d4 d5 Nf3")));
  });

  it("returns null before any named position", () => {
    expect(classifyOpening([])).toBeNull();
  });
});

describe("openingRecordView", () => {
  async function play(store: MemoryStore | SqlStore, jevColor: "w" | "b", result: Result, sans: string) {
    const game: Omit<GameRow, "id"> = { jevColor, oppElo: 900, ratingBefore: 900, ratingAfter: 900, result, termination: "checkmate", plies: 0, startedAt: 0, endedShowAt: 1 };
    const id = await store.createGame(game);
    let ply = 0;
    for (const san of line(sans)) await store.addPly({ gameId: id, ply: ply++, side: "jev", san, uci: "", fen: "", showAt: 0, data: {} });
  }

  for (const [label, make] of [
    ["memory store", async () => new MemoryStore()],
    ["SQLite store", async () => {
      const s = new SqlStore(sqliteD1(":memory:"), "sqlite");
      await s.init();
      return s;
    }],
  ] as const) {
    it(`adds up Jev's score per colour and opening (${label})`, async () => {
      const store = await make();
      await play(store, "w", "1-0", "e4 e5 Nf3 Nc6 Bb5 a6");
      await play(store, "w", "0-1", "e4 e5 Nf3 Nc6 Bb5 Nf6");
      await play(store, "b", "0-1", "e4 e5 Nf3 Nc6 Bb5 a6");
      const view = await openingRecordView(store, 10);
      expect(view.map((r) => [r.side, r.name, r.games, r.points])).toEqual([
        ["w", "Ruy Lopez: Berlin Defense", 1, 0],
        ["w", "Ruy Lopez: Morphy Defense", 1, 1],
        ["b", "Ruy Lopez: Morphy Defense", 1, 1],
      ]);
    });
  }
});
