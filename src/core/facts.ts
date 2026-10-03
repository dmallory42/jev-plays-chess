import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

// "Seeing, not calculating": everything here is a fact about the current position or about a
// single move and its immediate consequences on the board. Nothing searches for the opponent's
// best reply. Exchange sums on one square are included because Jev can't do arithmetic.

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const other = (c: Color): Color => (c === "w" ? "b" : "w");
export const colourName = (c: Color) => (c === "w" ? "White" : "Black");

/** The same facts as data, from the mover's side, for the viewer to draw. Jev only gets the sentences. */
export type Tag =
  | { k: "mate" | "check" | "draw" | "fork" | "castle" | "develop" | "defends" | "early-queen" | "king-walk" }
  | { k: "capture"; piece: PieceSymbol; square: Square }
  | { k: "gain" | "loss"; n: number; square: Square }
  | { k: "trade"; square: Square }
  | { k: "hangs"; piece: PieceSymbol; square: Square; n: number }
  | { k: "attacks"; piece: PieceSymbol; square: Square }
  | { k: "saves"; piece: PieceSymbol }
  | { k: "promote"; piece: PieceSymbol };

export interface MoveFacts {
  san: string;
  uci: string;
  move: string;
  captures?: string;
  material?: string;
  check?: string;
  risks?: string[];
  threatens?: string[];
  notes?: string[];
  tags: Tag[];
  /** Net material change for the mover from the exchange on the destination square plus the worst piece left en prise. Used by the rule-based control bot and tests, not sent to Jev. */
  netGain: number;
}

export interface PositionFacts {
  you_play: string;
  move_number: number;
  phase: string;
  board: string;
  pieces: { yours: string[]; opponent: string[] };
  material: string;
  in_check?: boolean;
  opponent_last_move?: string;
  threats_against_you?: string[];
  recent_moves?: string;
}

// Best material the side to move can gain by starting captures on `square` (0 if it shouldn't).
// Uses legal moves only, so pins and x-rays are handled by the board itself.
export function seeSquare(chess: Chess, square: Square): number {
  const captures = chess.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  if (captures.length === 0) return 0;
  captures.sort((a, b) => attackerOrder(a) - attackerOrder(b));
  const m = captures[0]!;
  const gained = PIECE_VALUE[m.captured!] + promotionGain(m);
  chess.move(m.san);
  const lost = seeSquare(chess, square);
  chess.undo();
  return Math.max(0, gained - lost);
}

const attackerOrder = (m: Move) => (m.piece === "k" ? 100 : PIECE_VALUE[m.piece]);
const promotionGain = (m: Move) => (m.promotion ? PIECE_VALUE[m.promotion] - 1 : 0);

// The same position with the other side to move, or null when that isn't a legal position.
function withTurn(chess: Chess, turn: Color): Chess | null {
  if (chess.turn() === turn) return new Chess(chess.fen());
  if (chess.inCheck()) return null;
  const parts = chess.fen().split(" ");
  parts[1] = turn;
  parts[3] = "-";
  try {
    return new Chess(parts.join(" "));
  } catch {
    return null;
  }
}

interface Hanging {
  square: Square;
  piece: PieceSymbol;
  loss: number;
}

// Pieces of `victim` that the other side could win material against right now, worst first.
function hangingPieces(chess: Chess, victim: Color): Hanging[] {
  const attackerView = withTurn(chess, other(victim));
  if (!attackerView) return [];
  const out: Hanging[] = [];
  for (const row of attackerView.board()) {
    for (const p of row) {
      if (!p || p.color !== victim || p.type === "k") continue;
      if (!attackerView.isAttacked(p.square, other(victim))) continue;
      const loss = seeSquare(attackerView, p.square);
      if (loss > 0) out.push({ square: p.square, piece: p.type, loss });
    }
  }
  return out.sort((a, b) => b.loss - a.loss);
}

const describeHanging = (h: Hanging, owner: "your" | "their") =>
  `${owner} ${PIECE_NAME[h.piece]} on ${h.square} can be won (${h.loss === PIECE_VALUE[h.piece] ? "for free" : `nets ${h.loss}`})`;

function materialCount(chess: Chess, c: Color) {
  let sum = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.color === c) sum += PIECE_VALUE[p.type];
  return sum;
}

function materialSummary(chess: Chess, you: Color) {
  const diff = materialCount(chess, you) - materialCount(chess, other(you));
  if (diff === 0) return "Material is level.";
  return diff > 0 ? `You are ahead by ${diff} (pawn = 1).` : `You are behind by ${-diff} (pawn = 1).`;
}

function phaseOf(chess: Chess) {
  const moveNo = Number(chess.fen().split(" ")[5]);
  let nonPawn = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== "p" && p.type !== "k") nonPawn += PIECE_VALUE[p.type];
  if (nonPawn <= 26) return "endgame";
  return moveNo <= 10 ? "opening" : "middlegame";
}

// Rank 8 at the top from White's view, rank 1 at the top from Black's, so "up the board" is always forwards.
export function asciiBoard(chess: Chess, you: Color) {
  const rows = chess.board().map((row, i) => `${8 - i} ${row.map((p) => (p ? (p.color === "w" ? p.type.toUpperCase() : p.type) : ".")).join(" ")}`);
  const files = "  a b c d e f g h";
  if (you === "w") return [...rows, files].join("\n");
  return [...rows.reverse().map((r) => r[0] + " " + r.slice(2).split(" ").reverse().join(" ")), "  h g f e d c b a"].join("\n");
}

function pieceList(chess: Chess, c: Color) {
  const order: PieceSymbol[] = ["k", "q", "r", "b", "n", "p"];
  const bySquare: { type: PieceSymbol; square: Square }[] = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === c) bySquare.push(p);
  bySquare.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.square.localeCompare(b.square));
  return bySquare.map((p) => `${PIECE_NAME[p.type]} ${p.square}`);
}

function describeMove(m: Move) {
  if (m.san.startsWith("O-O-O")) return "castle queenside";
  if (m.san.startsWith("O-O")) return "castle kingside";
  const base = `${PIECE_NAME[m.piece]} ${m.from} to ${m.to}`;
  return m.promotion ? `${base}, promoting to a ${PIECE_NAME[m.promotion]}` : base;
}

export function positionFacts(chess: Chess, recentSan: string[]): PositionFacts {
  const you = chess.turn();
  const facts: PositionFacts = {
    you_play: colourName(you),
    move_number: Number(chess.fen().split(" ")[5]),
    phase: phaseOf(chess),
    board: asciiBoard(chess, you),
    pieces: { yours: pieceList(chess, you), opponent: pieceList(chess, other(you)) },
    material: materialSummary(chess, you),
  };
  if (chess.inCheck()) facts.in_check = true;
  const last = chess.history({ verbose: true }).at(-1);
  if (last) facts.opponent_last_move = `${last.san}: ${describeMove(last)}${last.captured ? `, capturing your ${PIECE_NAME[last.captured]}` : ""}`;
  const threats = hangingPieces(chess, you).map((h) => describeHanging(h, "your"));
  if (threats.length) facts.threats_against_you = threats;
  if (recentSan.length) facts.recent_moves = recentSan.slice(-12).join(" ");
  return facts;
}

export function moveFacts(chess: Chess): MoveFacts[] {
  const you = chess.turn();
  const them = other(you);
  const threatenedBefore = new Set(hangingPieces(chess, you).map((h) => h.square));
  const opening = phaseOf(chess) === "opening";
  const out: MoveFacts[] = [];

  for (const m of chess.moves({ verbose: true })) {
    const f: MoveFacts = { san: m.san, uci: m.from + m.to + (m.promotion ?? ""), move: describeMove(m), netGain: 0, tags: [] };
    const tags = f.tags;
    const risks: string[] = [];
    const threatens: string[] = [];
    const notes: string[] = [];

    chess.move(m.san);
    const gained = (m.captured ? PIECE_VALUE[m.captured] : 0) + promotionGain(m);
    const recapture = seeSquare(chess, m.to);
    const exchange = gained - recapture;
    if (m.captured) {
      f.captures = `their ${PIECE_NAME[m.captured]} on ${m.to}`;
      tags.push({ k: "capture", piece: m.captured, square: m.to });
    }
    if (m.promotion) tags.push({ k: "promote", piece: m.promotion });

    if (chess.isCheckmate()) {
      f.check = "CHECKMATE: this move wins the game";
      tags.push({ k: "mate" });
    } else if (chess.isStalemate()) {
      notes.push("stalemate: the game ends in a draw");
      tags.push({ k: "draw" });
    } else if (chess.isDraw()) {
      notes.push("the game ends in a draw (repetition, fifty-move rule or insufficient material)");
      tags.push({ k: "draw" });
    } else if (chess.inCheck()) {
      f.check = "gives check";
      tags.push({ k: "check" });
    }

    // Our other pieces (not the one that moved) the opponent can now win.
    const hangingAfter = hangingPieces(chess, you).filter((h) => h.square !== m.to);
    const worst = hangingAfter[0];
    for (const h of hangingAfter.slice(0, 3)) risks.push(`leaves your ${PIECE_NAME[h.piece]} on ${h.square} open to capture (you can lose ${h.loss})`);
    if (recapture > 0 && !m.captured) risks.unshift(`the moved ${PIECE_NAME[m.promotion ?? m.piece]} can be taken on ${m.to} (you lose ${recapture})`);

    const net = exchange - (worst?.loss ?? 0);
    f.netGain = chess.isCheckmate() ? 1000 : net;
    if (m.captured || recapture > 0 || m.promotion) {
      if (exchange > 0) f.material = `wins ${exchange} on ${m.to}`;
      else if (exchange < 0) f.material = `loses ${-exchange} on ${m.to}`;
      else if (m.captured) f.material = "an even trade";
    }
    if (m.captured || m.promotion) {
      if (exchange > 0) tags.push({ k: "gain", n: exchange, square: m.to });
      else if (exchange < 0) tags.push({ k: "loss", n: -exchange, square: m.to });
      else tags.push({ k: "trade", square: m.to });
    } else if (recapture > 0) {
      tags.push({ k: "hangs", piece: m.promotion ?? m.piece, square: m.to, n: recapture });
    }
    for (const h of hangingAfter.slice(0, 3)) tags.push({ k: "hangs", piece: h.piece, square: h.square, n: h.loss });

    // Saving a threatened piece is only worth saying when it actually ends up safe.
    if (threatenedBefore.has(m.from) && recapture === 0) {
      notes.push(`moves your threatened ${PIECE_NAME[m.piece]} to safety`);
      tags.push({ k: "saves", piece: m.piece });
    }
    const stillThreatened = [...threatenedBefore].filter((sq) => sq !== m.from && hangingAfter.some((h) => h.square === sq));
    if (threatenedBefore.size > 0 && stillThreatened.length === 0 && !threatenedBefore.has(m.from) && !(m.captured && exchange > 0)) {
      notes.push("defends your threatened piece");
      tags.push({ k: "defends" });
    }

    // Enemy pieces the moved piece now attacks that are undefended or worth more than it.
    if (!chess.isGameOver()) {
      for (const row of chess.board()) {
        for (const p of row) {
          if (!p || p.color !== them || p.type === "k") continue;
          if (!chess.attackers(p.square, you).includes(m.to)) continue;
          const defended = chess.isAttacked(p.square, them);
          const mover = m.promotion ?? m.piece;
          if (!defended) threatens.push(`attacks their undefended ${PIECE_NAME[p.type]} on ${p.square}`);
          else if (PIECE_VALUE[p.type] > PIECE_VALUE[mover]) threatens.push(`attacks their ${PIECE_NAME[p.type]} on ${p.square} with a less valuable piece`);
          else continue;
          tags.push({ k: "attacks", piece: p.type, square: p.square });
        }
      }
      if (threatens.length + (chess.inCheck() ? 1 : 0) >= 2) {
        notes.push(chess.inCheck() ? "fork: checks the king and attacks a piece" : "fork: attacks two pieces at once");
        tags.push({ k: "fork" });
      }
    }

    if (m.san.startsWith("O-O")) {
      notes.push("castles, tucking your king away");
      tags.push({ k: "castle" });
    }
    if (opening && (m.piece === "n" || m.piece === "b") && (m.from[1] === "1" || m.from[1] === "8")) {
      notes.push("develops a piece");
      tags.push({ k: "develop" });
    }
    if (opening && m.piece === "q" && Number(chess.fen().split(" ")[5]) <= 6) {
      notes.push("early queen move");
      tags.push({ k: "early-queen" });
    }
    if (m.piece === "k" && !m.san.startsWith("O-O") && opening) {
      notes.push("moves the king, losing the right to castle");
      tags.push({ k: "king-walk" });
    }

    chess.undo();
    if (risks.length) f.risks = risks;
    if (threatens.length) f.threatens = threatens;
    if (notes.length) f.notes = notes;
    out.push(f);
  }
  return out;
}

/** Where things stood before a move, from the mover's side, for the viewer. */
export function positionSnapshot(chess: Chess) {
  const you = chess.turn();
  return {
    material: materialCount(chess, you) - materialCount(chess, other(you)),
    inCheck: chess.inCheck(),
    threatened: hangingPieces(chess, you).map((h) => ({ piece: h.piece, square: h.square, n: h.loss })),
  };
}

export interface ReplyDanger {
  /** A reply that checkmates, in SAN. */
  mate?: string;
  /** Replies that attack two of your things at once and can't simply be captured back. */
  forks: { san: string; piece: PieceSymbol; targets: { piece: PieceSymbol; square: Square }[]; loss: number }[];
}

// With the opponent to move, the checkmates and forks they have available. One move of looking ahead,
// the "checks, captures, threats" routine players are taught; nothing is scored beyond material.
export function replyDangers(chess: Chess): ReplyDanger {
  const them = chess.turn();
  const us = other(them);
  const out: ReplyDanger = { forks: [] };
  for (const r of chess.moves({ verbose: true })) {
    chess.move(r.san);
    if (chess.isCheckmate()) {
      out.mate ??= r.san;
      chess.undo();
      continue;
    }
    const forker = r.promotion ?? r.piece;
    const targets: { piece: PieceSymbol; square: Square }[] = [];
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p || p.color !== us) continue;
        if (!chess.attackers(p.square, them).includes(r.to)) continue;
        if (p.type === "k" || !chess.isAttacked(p.square, us) || PIECE_VALUE[p.type] > PIECE_VALUE[forker]) targets.push({ piece: p.type, square: p.square });
      }
    }
    // Not a real fork if we can just take the forking piece back for at least what it's worth.
    if (targets.length >= 2 && seeSquare(chess, r.to) < PIECE_VALUE[forker]) {
      const values = targets.filter((t) => t.piece !== "k").map((t) => PIECE_VALUE[t.piece]).sort((a, b) => b - a);
      // With a check, the other target falls; otherwise we save the bigger one and lose the smaller.
      const loss = targets.some((t) => t.piece === "k") ? (values[0] ?? 0) : (values[1] ?? 0);
      if (loss > 0) out.forks.push({ san: r.san, piece: forker, targets, loss });
    }
    chess.undo();
  }
  out.forks.sort((a, b) => b.loss - a.loss);
  return out;
}
