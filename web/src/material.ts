import type { Colour, PieceType } from "./notation";

const START: Record<Exclude<PieceType, "k">, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const VALUE: Record<Exclude<PieceType, "k">, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const ORDER = ["q", "r", "b", "n", "p"] as const;

export interface Captures {
  /** Pieces each side has taken from the other, most valuable first. */
  taken: Record<Colour, Exclude<PieceType, "k">[]>;
  /** Material balance in pawns, positive when White is ahead. */
  balance: number;
}

/** What each side has captured, from the pieces left on the board in `fen`. */
export function captures(fen: string): Captures {
  const count: Record<Colour, Record<string, number>> = { w: {}, b: {} };
  for (const ch of fen.split(" ")[0]!) {
    if (!/[pnbrqk]/i.test(ch)) continue;
    const side: Colour = ch === ch.toUpperCase() ? "w" : "b";
    count[side][ch.toLowerCase()] = (count[side][ch.toLowerCase()] ?? 0) + 1;
  }
  // A side's lost pieces, counting a promoted piece as the pawn it came from.
  const lost = (side: Colour) => {
    const has = (t: string) => count[side][t] ?? 0;
    const promoted = ORDER.filter((t) => t !== "p").reduce((n, t) => n + Math.max(0, has(t) - START[t]), 0);
    return ORDER.flatMap((t) => {
      const missing = t === "p" ? START.p - has("p") - promoted : START[t] - has(t);
      return Array<Exclude<PieceType, "k">>(Math.max(0, missing)).fill(t);
    });
  };
  const material = (side: Colour) => ORDER.reduce((n, t) => n + VALUE[t] * (count[side][t] ?? 0), 0);
  return { taken: { w: lost("b"), b: lost("w") }, balance: material("w") - material("b") };
}
