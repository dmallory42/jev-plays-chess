import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../deploy/node/server";
import { SqlStore } from "../src/core/sql-store";

async function freshStore() {
  const store = new SqlStore(sqliteD1(":memory:"), "sqlite");
  await store.init();
  return store;
}

describe("SqlStore on SQLite", () => {
  it("can be initialised twice without losing the ladder", async () => {
    const db = sqliteD1(":memory:");
    const store = new SqlStore(db, "sqlite");
    await store.init();
    const ladder = await store.getLadder();
    await store.saveLadder({ ...ladder, rating: 1234 });
    await new SqlStore(db, "sqlite").init();
    expect((await store.getLadder()).rating).toBe(1234);
  });

  it("gives the lease to one owner at a time", async () => {
    const store = await freshStore();
    expect(await store.tryLease("a", 1_000, 5_000)).toBe(true);
    expect(await store.tryLease("b", 2_000, 6_000)).toBe(false);
    await store.releaseLease("a");
    expect(await store.tryLease("b", 2_000, 6_000)).toBe(true);
  });

  it("adds to existing patterns and ranks them by how often they went wrong", async () => {
    const store = await freshStore();
    await store.addPatterns([{ key: "third", text: "t", wrong: true }, { key: "half", text: "h", wrong: true }], 1);
    await store.addPatterns([{ key: "third", text: "t", wrong: false }, { key: "half", text: "h2", wrong: false }], 2);
    await store.addPatterns([{ key: "third", text: "t", wrong: false }], 3);
    const all = await store.allPatterns(1, 10);
    expect(all.map((p) => [p.key, p.played, p.wrong])).toEqual([
      ["half", 2, 1],
      ["third", 3, 1],
    ]);
    expect(all[0]!.text).toBe("h2");
  });

  it("adds up opening records", async () => {
    const store = await freshStore();
    await store.addOpenings(["e4"], 1);
    await store.addOpenings(["e4"], 0.5);
    expect(await store.openings(["e4", "d4"])).toEqual({ e4: { games: 2, points: 1.5 } });
  });

  it("counts a returning viewer once", async () => {
    const store = await freshStore();
    await store.touchViewer("viewer01", 1_000);
    await store.touchViewer("viewer01", 2_000);
    expect(await store.countViewers(1_500)).toBe(1);
  });

  it("stores and reads back games", async () => {
    const store = await freshStore();
    const game = { jevColor: "w" as const, oppElo: 725, ratingBefore: 714, ratingAfter: null, result: null, termination: null, plies: 0, startedAt: 1_000, endedShowAt: null };
    expect(await store.createGame(game)).toBe(1);
    expect(await store.createGame(game)).toBe(2);
    expect(await store.getGame(2)).toEqual({ id: 2, ...game });
  });
});
