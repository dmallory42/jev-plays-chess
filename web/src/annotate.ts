// Move ratings (!!, !, ?!, ?, ??) from Stockfish, using Lichess's winning-chance thresholds.
import { Chess } from "chess.js";
import { moveFacts } from "../../src/core/facts";
import { winChance, type Analysis, type Evaluation } from "./eval";

export type Grade = "brilliant" | "great" | "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface Rating {
  grade: Grade;
  /** Winning chances the mover gave up compared with the engine's best move, 0 to 100. */
  loss: number;
}

export const SYMBOL: Partial<Record<Grade, string>> = { brilliant: "!!", great: "!", inaccuracy: "?!", mistake: "?", blunder: "??" };
export const LABEL: Record<Grade, string> = {
  brilliant: "Brilliant",
  great: "Great move",
  best: "Best move",
  good: "Good move",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

// The moved piece itself (a knight or bigger) is left to be taken, or loses material on its square.
function isSacrifice(fen: string, uci: string) {
  const to = uci.slice(2, 4);
  const f = moveFacts(new Chess(fen)).find((m) => m.uci === uci);
  return (f?.tags ?? []).some((t) => (t.k === "loss" && t.n >= 2) || (t.k === "hangs" && t.square === to && t.piece !== "p" && t.piece !== "k" && t.n >= 2));
}

/**
 * Rates one move. `before` is a MultiPV analysis of the position the move was played from,
 * `after` the evaluation once it was played (or of that move from a searchmoves line).
 */
export function rate(fen: string, uci: string, before: Analysis, after: Evaluation): Rating | null {
  const best = before.lines[0];
  if (!best) return null;
  const mover = fen.split(" ")[1] as "w" | "b";
  const bestChance = winChance(best.eval, mover);
  const moveChance = winChance(after, mover);
  const loss = Math.max(0, bestChance - moveChance);
  if (uci === best.uci || loss < 2) {
    if (uci === best.uci && bestChance < 95 && moveChance >= 50 && isSacrifice(fen, uci)) return { grade: "brilliant", loss };
    const second = before.lines[1];
    if (second && bestChance - winChance(second.eval, mover) >= 20) return { grade: "great", loss };
    return { grade: "best", loss };
  }
  if (loss >= 30) return { grade: "blunder", loss };
  if (loss >= 20) return { grade: "mistake", loss };
  if (loss >= 10) return { grade: "inaccuracy", loss };
  return { grade: "good", loss };
}

export function ratingTitle(r: Rating) {
  if (r.grade === "brilliant") return "Brilliant: the engine's choice, and it gives up material";
  if (r.grade === "great") return "Great move: the only good move here";
  if (r.grade === "best" || r.grade === "good") return `${LABEL[r.grade]} (Stockfish)`;
  return `${LABEL[r.grade]}: gives up ${Math.round(r.loss)}% winning chances (Stockfish)`;
}

export const nag = (r: Rating | undefined) =>
  r && SYMBOL[r.grade] ? `<span class="nag nag-${r.grade}" title="${ratingTitle(r)}">${SYMBOL[r.grade]}</span>` : "";
