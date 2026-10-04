import { Chess } from "chess.js";
import { pickOpponentElo, updateRating } from "./elo";
import type { JevDecision } from "./jev";
import { positionSnapshot, type MoveFacts } from "./facts";
import { learnFromGame, MEMORY_VERSION, type Memory, type Recall } from "./memory";
import type { GameRow, Ladder, PlyRow, Result, Store } from "./store";

export const MAX_PLIES = 300;
// A side resigns when its reading is at least this high on two of its turns in a row.
// Jev's yes/no answer tops out around 0.75 even in hopeless positions, so its bar is lower.
// Maia's is its own loss estimate, learned from how often players at that rating lose from there.
export const RESIGN_AT = { jev: 0.7, opp: 0.9 } as const;
// Nobody resigns before this many plies (move 10).
export const MIN_RESIGN_PLY = 18;

export interface OpponentMove {
  uci: string;
  top: { uci: string; san: string; p: number }[];
  /** The opponent's own win/draw/loss estimate for this position, from its side. */
  value?: { win: number; draw: number; loss: number };
}

export interface RunnerDeps {
  store: Store;
  jev: (chess: Chess, recentSan: string[]) => Promise<{ decision: JevDecision; facts: MoveFacts[]; recall?: Recall }>;
  /** Where Jev's lessons and opening records live. Without it Jev doesn't learn between games. */
  memory?: Memory;
  opponent: (input: { fen: string; historyUci: string[]; elo: number; jevElo: number }) => Promise<OpponentMove>;
  now?: () => number;
  /** Stop starting new plies after this long. */
  budgetMs: number;
  /** Viewers see one ply this often. */
  plyIntervalMs: number;
  /** Extra time after each of Jev's plies, while viewers see its options on the board before its piece moves. */
  jevThinkMs?: number;
  /**
   * In the first `plies` plies, how often Jev plays another move it gave some weight instead of its top pick, as long
   * as it doesn't lose material. Without this, its opening records reinforce whichever line it happened to try first.
   */
  explore?: { rate: number; plies: number; random?: () => number };
  /** Pause shown between games. */
  gameGapMs: number;
  /** Don't compute further ahead of the viewer clock than this. */
  maxAheadMs: number;
  /** Opponent rating for the next game. Defaults to Jev's current rating; the test harness fixes it. */
  pickOpponent?: (rating: number) => number;
}

export interface TickResult {
  skipped?: "leased" | "ahead";
  plies: number;
  gamesFinished: number;
}

export function replay(plies: PlyRow[]) {
  const chess = new Chess();
  for (const p of plies) chess.move(p.san);
  return chess;
}

function gameResult(chess: Chess, plies: number): { result: Result; termination: string } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === "w" ? "0-1" : "1-0", termination: "checkmate" };
  if (chess.isStalemate()) return { result: "1/2-1/2", termination: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "1/2-1/2", termination: "insufficient material" };
  if (chess.isThreefoldRepetition()) return { result: "1/2-1/2", termination: "threefold repetition" };
  if (chess.isDrawByFiftyMoves()) return { result: "1/2-1/2", termination: "fifty-move rule" };
  if (plies >= MAX_PLIES) return { result: "1/2-1/2", termination: `move limit (${MAX_PLIES / 2} moves)` };
  return null;
}

export function jevScore(result: Result, jevColor: "w" | "b"): 0 | 0.5 | 1 {
  if (result === "1/2-1/2") return 0.5;
  return (result === "1-0") === (jevColor === "w") ? 1 : 0;
}

// Jev must give a move at least this probability for it to be tried.
const EXPLORE_MIN_P = 0.01;

// An opening move to try instead of Jev's top pick, or null to play the pick. Picks among Jev's other options that
// don't lose material, in proportion to the probability Jev gave each, so its second choice comes up most.
export function exploreOpening(explore: RunnerDeps["explore"], plyCount: number, decision: Pick<JevDecision, "san" | "options">, facts: MoveFacts[]) {
  if (!explore || plyCount >= explore.plies) return null;
  const random = explore.random ?? Math.random;
  if (random() >= explore.rate) return null;
  const safe = new Map(facts.filter((f) => f.netGain >= 0).map((f) => [f.san, f]));
  const others = decision.options.filter((o) => o.san !== decision.san && o.p >= EXPLORE_MIN_P && safe.has(o.san));
  const total = others.reduce((n, o) => n + o.p, 0);
  if (!others.length || total <= 0) return null;
  let r = random() * total;
  for (const o of others) {
    r -= o.p;
    if (r < 0) return safe.get(o.san)!;
  }
  return safe.get(others.at(-1)!.san)!;
}

// Brief facts for the viewer: the chosen move and the top alternatives Jev weighed, plus the move it tried instead, if any.
function jevPlyData(decision: JevDecision, facts: MoveFacts[], before: ReturnType<typeof positionSnapshot>, recall?: Recall, explored?: string) {
  const bySan = new Map(facts.map((f) => [f.san, f]));
  const shown = decision.options.slice(0, 6);
  const extra = explored && !shown.some((o) => o.san === explored) ? decision.options.find((o) => o.san === explored) : undefined;
  const top = [...shown, ...(extra ? [extra] : [])].map((o) => {
    const f = bySan.get(o.san);
    return { san: o.san, uci: o.uci, p: o.p, tags: f?.tags ?? [] };
  });
  const remembered = recall && (Object.keys(recall.history).length || Object.keys(recall.openings).length) ? recall : undefined;
  return { confidence: decision.confidence, legal: decision.options.length, top, before, resign: decision.resign, remembered, latencyMs: decision.latencyMs, tokens: decision.inputTokens, model: decision.model, ...(explored ? { explored: true } : {}) };
}

// How ready each side was to resign on its previous turn.
function lastReading(plies: PlyRow[], side: PlyRow["side"]) {
  const prev = [...plies].reverse().find((p) => p.side === side);
  const d = prev?.data as { resign?: number; value?: { loss: number } } | undefined;
  return side === "jev" ? (d?.resign ?? 0) : (d?.value?.loss ?? 0);
}

const shouldResign = (side: PlyRow["side"], reading: number, previous: number, plyCount: number) =>
  plyCount >= MIN_RESIGN_PLY && reading >= RESIGN_AT[side] && previous >= RESIGN_AT[side];

async function finishGame(deps: RunnerDeps, ladder: Ladder, game: GameRow, plies: PlyRow[], outcome: { result: Result; termination: string }, shownAt: number) {
  const store = deps.store;
  const score = jevScore(outcome.result, game.jevColor);
  const after = updateRating(ladder.rating, game.oppElo, score, ladder.games);
  await store.updateGame({ ...game, result: outcome.result, termination: outcome.termination, ratingAfter: after, endedShowAt: shownAt });
  ladder.rating = after;
  ladder.games += 1;
  if (score === 1) ladder.wins += 1;
  else if (score === 0) ladder.losses += 1;
  else ladder.draws += 1;
  ladder.currentGameId = null;
}

// Learns from finished games not yet in memory, a few per tick, in game order. Each game is learned
// from exactly once, and games played before memory existed get picked up too.
// Learning takes several seconds per game in the worker, so one game per tick.
const LEARN_PER_TICK = 1;
async function catchUpMemory(deps: RunnerDeps, ladder: Ladder) {
  if (!deps.memory) return 0;
  if (ladder.memoryVersion !== MEMORY_VERSION) {
    await deps.memory.reset();
    ladder.memoryUpTo = 0;
    ladder.memoryVersion = MEMORY_VERSION;
    await deps.store.saveLadder(ladder);
  }
  let learned = 0;
  while (learned < LEARN_PER_TICK) {
    const id = (ladder.memoryUpTo ?? 0) + 1;
    const g = await deps.store.getGame(id);
    if (!g || g.result === null) break;
    // Marked as learned first: if the worker is cut off part way, the game is skipped rather than counted twice.
    ladder.memoryUpTo = id;
    await deps.store.saveLadder(ladder);
    const plies = await deps.store.getPlies(id);
    await learnFromGame(deps.memory, plies.map((p) => p.san), g.jevColor, g.id, jevScore(g.result, g.jevColor));
    learned++;
  }
  return learned;
}

export async function tick(deps: RunnerDeps): Promise<TickResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const owner = `${started}-${Math.random().toString(36).slice(2, 8)}`;
  const out: TickResult = { plies: 0, gamesFinished: 0 };
  if (!(await deps.store.tryLease(owner, started, started + deps.budgetMs + 15_000))) return { ...out, skipped: "leased" };

  try {
    const ladder = await deps.store.getLadder();
    // A tick that learned has used part of its time, so it plays for less.
    const learned = await catchUpMemory(deps, ladder);
    const budget = learned ? deps.budgetMs / 2 : deps.budgetMs;
    while (now() - started < budget) {
      if (ladder.nextShowAt > now() + deps.maxAheadMs) {
        if (out.plies === 0) out.skipped = "ahead";
        break;
      }

      let game = ladder.currentGameId ? await deps.store.getGame(ladder.currentGameId) : null;
      if (!game) {
        const fields: Omit<GameRow, "id"> = {
          jevColor: ladder.games % 2 === 0 ? "w" : "b",
          oppElo: (deps.pickOpponent ?? pickOpponentElo)(ladder.rating),
          ratingBefore: ladder.rating,
          ratingAfter: null,
          result: null,
          termination: null,
          plies: 0,
          startedAt: Math.max(now(), ladder.nextShowAt),
          endedShowAt: null,
        };
        game = { ...fields, id: await deps.store.createGame(fields) };
        ladder.currentGameId = game.id;
        await deps.store.saveLadder(ladder);
      }

      const plies = await deps.store.getPlies(game.id);
      const chess = replay(plies);
      const ended = gameResult(chess, plies.length);
      if (ended) {
        await finishGame(deps, ladder, game, plies, ended, plies.at(-1)?.showAt ?? now());
        ladder.nextShowAt = Math.max(ladder.nextShowAt, now()) + deps.gameGapMs;
        await deps.store.saveLadder(ladder);
        out.gamesFinished += 1;
        continue;
      }

      const jevToMove = chess.turn() === game.jevColor;
      let ply: Omit<PlyRow, "showAt" | "fen">;
      let resigns = false;
      if (jevToMove) {
        const before = positionSnapshot(chess);
        const { decision, facts, recall } = await deps.jev(chess, plies.map((p) => p.san));
        ladder.jevCalls += 1;
        ladder.jevTokens += decision.inputTokens;
        resigns = shouldResign("jev", decision.resign, lastReading(plies, "jev"), plies.length);
        const explored = exploreOpening(deps.explore, plies.length, decision, facts);
        const played = explored ?? decision;
        ply = { gameId: game.id, ply: plies.length, side: "jev", san: played.san, uci: played.uci, data: jevPlyData(decision, facts, before, recall, explored?.san) };
      } else {
        const move = await deps.opponent({ fen: chess.fen(), historyUci: plies.map((p) => p.uci), elo: game.oppElo, jevElo: Math.round(ladder.rating) });
        const san = chess.move(move.uci).san;
        chess.undo();
        resigns = shouldResign("opp", move.value?.loss ?? 0, lastReading(plies, "opp"), plies.length);
        ply = { gameId: game.id, ply: plies.length, side: "opp", san, uci: move.uci, data: { top: move.top.slice(0, 5), value: move.value } };
      }

      if (resigns) {
        // The side to move resigns instead of playing; viewers see it on the next beat.
        const loserIsWhite = chess.turn() === "w";
        const shownAt = Math.max(now(), ladder.nextShowAt);
        await finishGame(deps, ladder, game, plies, { result: loserIsWhite ? "0-1" : "1-0", termination: "resignation" }, shownAt);
        ladder.nextShowAt = shownAt + deps.gameGapMs;
        await deps.store.saveLadder(ladder);
        out.gamesFinished += 1;
        continue;
      }
      chess.move(ply.san);
      const showAt = Math.max(now(), ladder.nextShowAt);
      await deps.store.addPly({ ...ply, fen: chess.fen(), showAt });
      ladder.nextShowAt = showAt + deps.plyIntervalMs + (ply.side === "jev" ? (deps.jevThinkMs ?? 0) : 0);
      game.plies = plies.length + 1;
      await deps.store.updateGame(game);
      await deps.store.saveLadder(ladder);
      out.plies += 1;
    }
    return out;
  } finally {
    await deps.store.releaseLease(owner);
  }
}
