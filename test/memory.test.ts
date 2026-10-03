import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { costlyPlies, FLAG_MIN_PLAYED, learnFromGame, MemoryMemory, movesFromGame, openingKeys, recall } from "../src/core/memory";

describe("costlyPlies", () => {
  it("marks a move that lost material soon after", () => {
    // 1. e4 e5 2. Qh5 Nc6 3. Qxe5+?? Nxe5: White's queen takes a defended pawn and is lost.
    expect(costlyPlies(["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5", "d4"], "w")).toEqual(new Set([4]));
  });

  it("counts a fork's loss, which only lands a move later", () => {
    // With White's queen off on h5, 3. Bc4 leaves c2 unguarded: Nxc2+ forks king and rook.
    expect(costlyPlies(["e4", "Nc6", "Qh5", "Nb4", "Bc4", "Nxc2+", "Kd1", "Nxa1", "Qxf7#"], "w").has(4)).toBe(true);
  });

  it("marks the last move before being mated", () => {
    expect(costlyPlies(["f3", "e5", "g4", "Qh4#"], "w")).toEqual(new Set([2]));
  });

  it("does not treat an even trade as a mistake", () => {
    expect(costlyPlies(["e4", "d5", "exd5", "Qxd5", "Nc3"], "w")).toEqual(new Set());
  });
});

describe("movesFromGame", () => {
  it("files every Jev move under its kind, with whether it went wrong", () => {
    const moves = movesFromGame(["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5", "d4"], "w");
    expect(moves).toHaveLength(4);
    expect(moves[2]).toMatchObject({ wrong: true });
    expect(moves[2]!.text).toBe("queen capture with check that loses material, onto a square they attack and you don't defend, in the opening");
    expect(moves[0]!.wrong).toBe(false);
  });
});

describe("recall", () => {
  it("flags a candidate only once its kind has gone wrong often enough", async () => {
    const memory = new MemoryMemory();
    // The same queen blunder, repeated: Qh5 then Qxe5+ losing the queen.
    const blunder = ["e4", "e5", "Qh5", "Nc6", "Qxe5+", "Nxe5", "d4"];
    const before = new Chess();
    for (const san of blunder.slice(0, 4)) before.move(san);
    for (let g = 1; g < FLAG_MIN_PLAYED; g++) await learnFromGame(memory, blunder, "w", g, 0);
    expect((await recall(memory, before, blunder.slice(0, 4))).history["Qxe5+"]).toBeUndefined();
    await learnFromGame(memory, blunder, "w", FLAG_MIN_PLAYED, 0);
    const r = await recall(memory, before, blunder.slice(0, 4));
    expect(r.history["Qxe5+"]).toBe(`moves like this went wrong in ${FLAG_MIN_PLAYED} of your last ${FLAG_MIN_PLAYED} tries`);
    // Safe moves of a kind that has never gone wrong aren't flagged.
    expect(r.history["Nf3"]).toBeUndefined();
  });

  it("keeps an opening record per move", async () => {
    expect(openingKeys(["e4", "e5", "Nf3", "Nc6"], "w")).toEqual(["w:e4", "w:e4 e5 Nf3"]);
    expect(openingKeys(["e4", "e5", "Nf3", "Nc6"], "b")).toEqual(["b:e4 e5", "b:e4 e5 Nf3 Nc6"]);
    const memory = new MemoryMemory();
    await learnFromGame(memory, ["f3", "e5", "g4", "Qh4#"], "w", 1, 0);
    await learnFromGame(memory, ["f3", "e5", "g4", "Qh4#"], "w", 2, 0);
    expect((await recall(memory, new Chess(), [])).openings).toEqual({ f3: "played in 2 past games, scored 0%" });
  });
});
