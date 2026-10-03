import { Chess, type Move, type PieceSymbol } from "chess.js";
import { moveFacts, PIECE_NAME, PIECE_VALUE, replyDangers, type MoveFacts } from "./facts";

// Jev's memory of its own games, the way a player reviews their games without an engine.
// Every move Jev plays is filed under its kind (piece, material outcome, how safe the square is,
// game phase) with whether it went wrong, and each opening line gets a win/loss record.
// Both are shown next to the specific moves they apply to, never as general advice.

export interface Pattern {
  /** The kind of move, e.g. "q|safe|-|AD|middlegame". */
  key: string;
  /** Plain description of that kind of move. */
  text: string;
  played: number;
  /** Times it lost material or was followed by mate shortly after. */
  wrong: number;
  lastGame: number;
}

export interface OpeningRecord {
  games: number;
  points: number;
}

export interface Memory {
  patterns(keys: string[]): Promise<Record<string, Pattern>>;
  /** Patterns played at least `minPlayed` times, most often wrong first. */
  allPatterns(minPlayed: number, limit: number): Promise<Pattern[]>;
  /** Adds one game's moves: each pattern played once more, and wrong once more when it went wrong. */
  addPatterns(moves: { key: string; text: string; wrong: boolean }[], gameId: number): Promise<void>;
  openings(keys: string[]): Promise<Record<string, OpeningRecord>>;
  /** Every opening line played at least `minGames` times, most played first. */
  allOpenings(minGames: number, limit: number): Promise<({ key: string } & OpeningRecord)[]>;
  addOpenings(keys: string[], points: number): Promise<void>;
  /** Forgets everything, before relearning from all games when the memory format changes. */
  reset(): Promise<void>;
}

// Bumped when what's learned from a game changes, so the live site relearns from every game once.
export const MEMORY_VERSION = 3;
// Openings are remembered up to this many plies (move 6 for each side).
export const OPENING_PLIES = 12;
// A material drop this big two plies later counts as the move having gone wrong.
const COSTLY = 2;
// A move kind is only flagged once it has enough history and goes wrong this often.
export const FLAG_MIN_PLAYED = 4;
export const FLAG_MIN_RATE = 0.35;

export const openingKey = (jevColor: "w" | "b", sans: string[]) => `${jevColor}:${sans.join(" ")}`;

function material(chess: Chess, side: "w" | "b") {
  let sum = 0;
  for (const row of chess.board()) for (const p of row) if (p) sum += (p.color === side ? 1 : -1) * PIECE_VALUE[p.type];
  return sum;
}

function phaseOf(chess: Chess, ply: number) {
  let heavy = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== "p" && p.type !== "k") heavy++;
  return heavy <= 6 ? "endgame" : ply < 20 ? "opening" : "middlegame";
}

const outcomeOf = (f: MoveFacts) => (f.netGain >= 1000 ? "mate" : f.netGain > 0 ? "wins" : f.netGain < 0 ? "loses" : "safe");

/** The kind of move `m` is, from the position before it. Two moves of the same kind share a key. */
export function moveKind(chess: Chess, m: Move, facts: MoveFacts, ply: number) {
  const outcome = outcomeOf(facts);
  const phase = phaseOf(chess, ply);
  chess.move(m.san);
  const attacked = chess.isAttacked(m.to, chess.turn());
  const defended = chess.isAttacked(m.to, m.color);
  chess.undo();
  const action = `${m.captured ? "x" : "-"}${m.san.includes("+") ? "+" : ""}`;
  const key = `${m.piece}|${outcome}|${action}|${attacked ? "A" : ""}${defended ? "D" : ""}|${phase}`;

  const verb = m.san.startsWith("O-O") ? "castling" : `${PIECE_NAME[m.piece]} ${m.captured ? "capture" : "move"}${m.san.includes("+") ? " with check" : ""}`;
  const material = { mate: "", wins: " that wins material", safe: "", loses: " that loses material" }[outcome];
  const square = attacked ? (defended ? "onto a square they attack but you defend" : "onto a square they attack and you don't defend") : "onto a square they don't attack";
  return { key, text: `${verb}${material}, ${square}, in the ${phase}` };
}

/** Which of Jev's moves (by ply index) went wrong: lost material soon after, or led to being mated. */
export function costlyPlies(sans: string[], jevColor: "w" | "b") {
  const chess = new Chess();
  const positions: string[] = [chess.fen()];
  for (const san of sans) {
    chess.move(san);
    positions.push(chess.fen());
  }
  const wrong = new Set<number>();
  if (chess.isCheckmate() && chess.turn() === jevColor && sans.length >= 2) wrong.add(sans.length - 2);
  for (let i = 0; i < sans.length; i++) {
    if (new Chess(positions[i]!).turn() !== jevColor) continue;
    const reply = sans[i + 1];
    const fork = reply ? replyDangers(new Chess(positions[i + 1]!)).forks.find((f) => f.san === reply) : undefined;
    // Compare material after Jev's next move, so a normal recapture doesn't count as a loss.
    // A fork only pays off a move later (the king steps away, then the rook falls), so look one move further.
    const later = positions[Math.min(i + (fork ? 5 : 3), positions.length - 1)]!;
    if (material(new Chess(positions[i]!), jevColor) - material(new Chess(later), jevColor) >= COSTLY) wrong.add(i);
  }
  return wrong;
}

/** Every Jev move in a finished game, with its kind and whether it went wrong. */
export function movesFromGame(sans: string[], jevColor: "w" | "b") {
  const wrong = costlyPlies(sans, jevColor);
  const chess = new Chess();
  const out: { key: string; text: string; wrong: boolean }[] = [];
  sans.forEach((san, i) => {
    if (chess.turn() === jevColor) {
      const facts = moveFacts(chess);
      const f = facts.find((x) => x.san === san);
      const m = chess.moves({ verbose: true }).find((x) => x.san === san);
      if (f && m) out.push({ ...moveKind(chess, m, f, i), wrong: wrong.has(i) });
    }
    chess.move(san);
  });
  return out;
}

/** Opening keys for every prefix ending in one of Jev's own moves. */
export function openingKeys(sans: string[], jevColor: "w" | "b") {
  const keys: string[] = [];
  for (let k = 1; k <= Math.min(OPENING_PLIES, sans.length); k++) {
    const moverIsJev = (k % 2 === 1) === (jevColor === "w");
    if (moverIsJev) keys.push(openingKey(jevColor, sans.slice(0, k)));
  }
  return keys;
}

export async function learnFromGame(memory: Memory, sans: string[], jevColor: "w" | "b", gameId: number, jevPoints: number) {
  await memory.addPatterns(movesFromGame(sans, jevColor), gameId);
  await memory.addOpenings(openingKeys(sans, jevColor), jevPoints);
}

export interface Recall {
  /** Per candidate move (SAN): a warning when moves of its kind have often gone wrong. */
  history: Record<string, string>;
  /** Per candidate move (SAN): Jev's record after playing it, in the opening only. */
  openings: Record<string, string>;
}

/** What Jev remembers about each move it could play now. */
export async function recall(memory: Memory, chess: Chess, history: string[], precomputed?: MoveFacts[]): Promise<Recall> {
  const facts = new Map((precomputed ?? moveFacts(chess)).map((f) => [f.san, f]));
  const kinds = new Map<string, string>();
  for (const m of chess.moves({ verbose: true })) {
    const f = facts.get(m.san);
    if (f && f.netGain < 1000) kinds.set(m.san, moveKind(chess, m, f, history.length).key);
  }
  const patterns = await memory.patterns([...new Set(kinds.values())]);
  const flagged: Record<string, string> = {};
  for (const [san, key] of kinds) {
    const p = patterns[key];
    if (p && p.played >= FLAG_MIN_PLAYED && p.wrong / p.played >= FLAG_MIN_RATE) flagged[san] = `moves like this went wrong in ${p.wrong} of your last ${p.played} tries`;
  }

  const openings: Record<string, string> = {};
  if (history.length < OPENING_PLIES) {
    const jevColor = chess.turn();
    const sans = chess.moves();
    const keys = sans.map((s) => openingKey(jevColor, [...history, s]));
    const records = await memory.openings(keys);
    sans.forEach((s, i) => {
      const r = records[keys[i]!];
      if (r && r.games >= 2) openings[s] = `played in ${r.games} past games, scored ${Math.round((100 * r.points) / r.games)}%`;
    });
  }
  return { history: flagged, openings };
}

// In-memory version for tests and the tournament harness.
export class MemoryMemory implements Memory {
  private patternMap = new Map<string, Pattern>();
  private openingMap = new Map<string, OpeningRecord>();

  async patterns(keys: string[]) {
    const out: Record<string, Pattern> = {};
    for (const k of keys) {
      const p = this.patternMap.get(k);
      if (p) out[k] = p;
    }
    return out;
  }

  async allPatterns(minPlayed: number, limit: number) {
    return [...this.patternMap.values()]
      .filter((p) => p.played >= minPlayed)
      .sort((a, b) => b.wrong / b.played - a.wrong / a.played || b.played - a.played)
      .slice(0, limit);
  }

  async addPatterns(moves: { key: string; text: string; wrong: boolean }[], gameId: number) {
    for (const m of moves) {
      const p = this.patternMap.get(m.key) ?? { key: m.key, text: m.text, played: 0, wrong: 0, lastGame: gameId };
      this.patternMap.set(m.key, { ...p, played: p.played + 1, wrong: p.wrong + (m.wrong ? 1 : 0), lastGame: gameId });
    }
  }

  async openings(keys: string[]) {
    const out: Record<string, OpeningRecord> = {};
    for (const k of keys) {
      const r = this.openingMap.get(k);
      if (r) out[k] = r;
    }
    return out;
  }

  async allOpenings(minGames: number, limit: number) {
    return [...this.openingMap.entries()]
      .filter(([, r]) => r.games >= minGames)
      .map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => b.games - a.games)
      .slice(0, limit);
  }

  async addOpenings(keys: string[], points: number) {
    for (const k of keys) {
      const r = this.openingMap.get(k) ?? { games: 0, points: 0 };
      this.openingMap.set(k, { games: r.games + 1, points: r.points + points });
    }
  }

  async reset() {
    this.patternMap.clear();
    this.openingMap.clear();
  }
}
