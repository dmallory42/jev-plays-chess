import { describe, expect, it } from "vitest";
import { captures } from "../web/src/material";

describe("captures", () => {
  it("is empty at the start", () => {
    expect(captures("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toEqual({ taken: { w: [], b: [] }, balance: 0 });
  });

  it("lists each side's captures, most valuable first, and the balance", () => {
    // White has taken a knight and a pawn; Black has taken a pawn.
    expect(captures("r1bqkbnr/ppp2ppp/8/8/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 4")).toEqual({ taken: { w: ["n", "p", "p"], b: ["p"] }, balance: 4 });
  });

  it("counts a promoted piece as the pawn it came from", () => {
    // White promoted its h-pawn to a second queen and has lost a rook; Black has lost its queen.
    expect(captures("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNQ w Qkq - 0 30").taken.b).toEqual(["r"]);
  });
});
