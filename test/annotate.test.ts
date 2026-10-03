import { describe, expect, it } from "vitest";
import { rate } from "../web/src/annotate";
import type { Analysis, Evaluation } from "../web/src/eval";

const ev = (cp: number, whiteToMove = true): Evaluation => ({ cp, depth: 12, whiteToMove });
const analysis = (fen: string, lines: [string, number][]): Analysis => ({ fen, depth: 12, lines: lines.map(([uci, cp]) => ({ uci, eval: ev(cp) })) });

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("rate", () => {
  it("grades by winning chances lost against the best move", () => {
    const before = analysis(START, [["e2e4", 30], ["d2d4", 25]]);
    expect(rate(START, "e2e4", before, ev(30))!.grade).toBe("best");
    expect(rate(START, "g2g4", before, ev(-20))!.grade).toBe("good");
    expect(rate(START, "g2g4", before, ev(-90))!.grade).toBe("inaccuracy");
    expect(rate(START, "f2f3", before, ev(-250))!.grade).toBe("mistake");
    expect(rate(START, "g1h3", before, ev(-500))!.grade).toBe("blunder");
  });

  it("uses the mover's side for Black", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const before = analysis(fen, [["e7e5", 30]]);
    // White's eval jumping to +5 is a blunder by Black.
    expect(rate(fen, "f7f6", before, ev(500))!.grade).toBe("blunder");
  });

  it("calls the only good move great", () => {
    const before = analysis(START, [["e2e4", 0], ["d2d4", -400]]);
    expect(rate(START, "e2e4", before, ev(0))!.grade).toBe("great");
  });

  it("does not call a king move or a losing side's move brilliant", () => {
    const fen = "r1b2rk1/ppp2ppp/8/8/8/3B4/PPP2PPP/R3Q1K1 w - - 0 1";
    // Rook lift leaving the queen hanging isn't a sacrifice of the moved piece.
    expect(rate(fen, "a1b1", analysis(fen, [["a1b1", 50]]), ev(50))!.grade).not.toBe("brilliant");
    // The queen sac while already losing isn't brilliant either.
    expect(rate(fen, "e1e8", analysis(fen, [["e1e8", -300]]), ev(-300))!.grade).not.toBe("brilliant");
  });

  it("calls a best move that gives up material brilliant", () => {
    // Qxh7+ with the queen left en prise to the king is the engine's choice here.
    const fen = "r1b2rk1/ppp2ppp/8/8/8/3B4/PPP2PPP/R3Q1K1 w - - 0 1";
    const before = analysis(fen, [["e1e8", 50], ["d3h7", 40]]);
    expect(rate(fen, "e1e8", before, ev(50))!.grade).toBe("brilliant");
  });

  it("treats checkmate as the best possible outcome", () => {
    const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    const before: Analysis = { fen, depth: 12, lines: [{ uci: "a1a8", eval: { mate: 1, depth: 12, whiteToMove: true } }] };
    expect(rate(fen, "a1a8", before, { mate: 0, depth: 0, whiteToMove: false })!.grade).toBe("best");
  });
});
