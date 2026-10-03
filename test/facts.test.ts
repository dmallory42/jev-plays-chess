import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { moveFacts, positionFacts, seeSquare } from "../src/core/facts";

const factsFor = (fen: string, san: string) => {
  const f = moveFacts(new Chess(fen)).find((m) => m.san === san);
  if (!f) throw new Error(`${san} not legal`);
  return f;
};

describe("seeSquare", () => {
  it("wins a free piece", () => {
    // White to move, black knight on e5 undefended, attacked by the d4 pawn.
    const chess = new Chess("4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1");
    expect(seeSquare(chess, "e5")).toBe(3);
  });

  it("does not take a defended pawn with the queen", () => {
    const chess = new Chess("4k3/8/3p4/4p3/8/8/8/4KQ2 w - - 0 1");
    expect(seeSquare(chess, "e5")).toBe(0);
  });
});

describe("moveFacts", () => {
  it("flags checkmate", () => {
    const f = factsFor("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "Ra8#");
    expect(f.check).toMatch(/CHECKMATE/);
    expect(f.netGain).toBe(1000);
  });

  it("flags a move that hangs the moved piece", () => {
    // Nc3-d5 walks into the e6 pawn.
    const f = factsFor("4k3/8/4p3/8/8/2N5/8/4K3 w - - 0 1", "Nd5");
    expect(f.risks?.[0]).toMatch(/knight can be taken on d5 \(you lose 3\)/);
    expect(f.netGain).toBe(-3);
  });

  it("flags a move that leaves another piece en prise", () => {
    // The b1 rook guards the b3 bishop; moving it off the b-file drops the bishop to the b8 rook.
    const f = factsFor("1r2k3/8/8/8/8/1B6/8/1R2K3 w - - 0 1", "Ra1");
    expect(f.risks?.join()).toMatch(/leaves your bishop on b3 open to capture \(you can lose 3\)/);
    expect(f.netGain).toBe(-3);
  });

  it("reports a winning capture and an even trade", () => {
    expect(factsFor("4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1", "dxe5").material).toBe("wins 3 on e5");
    expect(factsFor("4k3/3p4/4n3/8/3N4/8/8/4K3 w - - 0 1", "Nxe6").material).toBe("an even trade");
  });

  it("spots a knight fork", () => {
    const f = factsFor("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "Nc7+");
    expect(f.check).toBe("gives check");
    expect(f.notes).toContain("fork: checks the king and attacks a piece");
    expect(f.threatens?.join()).toMatch(/rook on a8/);
  });

  it("notices when a threatened piece is moved to safety", () => {
    // The b5 pawn attacks the knight on c4.
    const f = factsFor("4k3/8/8/1p6/2N5/8/8/4K3 w - - 0 1", "Ne3");
    expect(f.notes).toContain("moves your threatened knight to safety");
  });
});

describe("positionFacts", () => {
  it("describes threats and material from the mover's side", () => {
    const chess = new Chess("4k3/8/8/1p6/2N5/8/8/4K3 w - - 0 1");
    const p = positionFacts(chess, []);
    expect(p.you_play).toBe("White");
    expect(p.material).toBe("You are ahead by 2 (pawn = 1).");
    expect(p.threats_against_you).toEqual(["your knight on c4 can be won (for free)"]);
  });

  it("draws the board from Black's side for Black", () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/R3K3 b - - 0 1");
    const lines = positionFacts(chess, []).board.split("\n");
    expect(lines[0]).toBe("1 . . . K . . . R");
    expect(lines.at(-1)).toBe("  h g f e d c b a");
  });
});

describe("tags", () => {
  it("records captures, gains, hanging pieces and attacks as data", () => {
    expect(factsFor("4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1", "dxe5").tags).toEqual([
      { k: "capture", piece: "n", square: "e5" },
      { k: "gain", n: 3, square: "e5" },
    ]);
    expect(factsFor("4k3/8/4p3/8/8/2N5/8/4K3 w - - 0 1", "Nd5").tags).toContainEqual({ k: "hangs", piece: "n", square: "d5", n: 3 });
    const fork = factsFor("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "Nc7+").tags;
    expect(fork).toContainEqual({ k: "check" });
    expect(fork).toContainEqual({ k: "attacks", piece: "r", square: "a8" });
    expect(fork).toContainEqual({ k: "fork" });
  });

  it("keeps tags out of what Jev is sent", async () => {
    const { buildJevRequest } = await import("../src/core/jev");
    const { request } = buildJevRequest(new Chess(), []);
    expect(JSON.stringify(request)).not.toContain('"tags"');
  });
});

describe("replyDangers", () => {
  it("finds a mate in one and a knight fork for the side to move", async () => {
    const { replyDangers } = await import("../src/core/facts");
    expect(replyDangers(new Chess("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")).mate).toBe("Ra8#");
    // Black's knight on d4 can fork the king on e1 and the rook on a1 from c2.
    const d = replyDangers(new Chess("4k3/8/8/8/3n4/8/8/R3K3 b - - 0 1"));
    expect(d.forks[0]).toMatchObject({ san: "Nc2+", loss: 5 });
  });

  it("ignores a fork by a piece that can simply be taken back", async () => {
    const { replyDangers } = await import("../src/core/facts");
    // Same fork, but the queen on d1 covers c2.
    const d = replyDangers(new Chess("4k3/8/8/8/3n4/8/8/R2QK3 b - - 0 1"));
    expect(d.forks.find((f) => f.san === "Nc2+")).toBeUndefined();
  });
});
