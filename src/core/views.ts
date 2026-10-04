import { START_RATING } from "./elo";
import { classifyOpening, OPENING_NAME_PLIES } from "./openings";
import { jevScore } from "./runner";
import type { GameFilter, GameRow, PlyRow, Store } from "./store";

// What the public page shows. Everything is cut off at "now" so viewers never see ahead of the stream.

export const gameView = (g: GameRow) => ({
  id: g.id,
  jevColor: g.jevColor,
  oppElo: g.oppElo,
  ratingBefore: Math.round(g.ratingBefore),
  ratingAfter: g.ratingAfter === null ? null : Math.round(g.ratingAfter),
  result: g.result,
  termination: g.termination,
  plies: g.plies,
  startedAt: g.startedAt,
  endedAt: g.endedShowAt,
});

export const plyView = (p: PlyRow) => ({ ply: p.ply, side: p.side, san: p.san, uci: p.uci, fen: p.fen, showAt: p.showAt, data: p.data });

export async function summaryView(store: Store, now: number) {
  const history = await store.shownHistory(now);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const g of history) {
    const s = jevScore(g.result!, g.jevColor);
    if (s === 1) wins++;
    else if (s === 0) losses++;
    else draws++;
  }
  const last = history.at(-1);
  return {
    rating: Math.round(last?.ratingAfter ?? START_RATING),
    peak: Math.round(Math.max(START_RATING, ...history.map((g) => g.ratingAfter ?? 0))),
    games: history.length,
    wins,
    draws,
    losses,
    history: history.map((g) => ({ id: g.id, rating: Math.round(g.ratingAfter!), oppElo: g.oppElo, score: jevScore(g.result!, g.jevColor), jevColor: g.jevColor })),
    recent: history.slice(-20).reverse().map(gameView),
  };
}

// A page counts as watching if it checked in within this window. Pages check in every 10s.
export const WATCHING_WINDOW_MS = 30_000;

export async function liveView(store: Store, now: number, knownGame: number | null, afterPly: number, viewerId: string | null) {
  if (viewerId) await store.touchViewer(viewerId, now);
  const watching = await store.countViewers(now - WATCHING_WINDOW_MS);
  const game = await store.shownGame(now);
  if (!game) return { now, watching, game: null, plies: [], nextShowAt: await store.nextShowAt(now) };
  const from = knownGame === game.id ? afterPly : -1;
  const plies = await store.shownPlies(game.id, from, now);
  return {
    now,
    watching,
    game: gameView({ ...game, ...(game.endedShowAt !== null && game.endedShowAt > now ? { result: null, termination: null, ratingAfter: null, endedShowAt: null } : {}) }),
    plies: plies.map(plyView),
    nextShowAt: await store.nextShowAt(now),
  };
}

/** Jev's record in each named opening it has reached, per colour, most played first. */
export async function openingRecordView(store: Store, now: number) {
  const [games, moves] = await Promise.all([store.shownHistory(now), store.openingMoves(OPENING_NAME_PLIES, now)]);
  const records = new Map<string, { side: "w" | "b"; eco: string; name: string; family: string; games: number; points: number }>();
  for (const g of games) {
    if (!g.result) continue;
    const opening = classifyOpening(moves.get(g.id) ?? []) ?? { eco: "", name: "Unnamed line", family: "Unnamed line" };
    const key = `${g.jevColor}:${opening.name}`;
    const r = records.get(key) ?? { side: g.jevColor, ...opening, games: 0, points: 0 };
    r.games++;
    r.points += jevScore(g.result, g.jevColor);
    records.set(key, r);
  }
  return [...records.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/** A page of finished games for the games list, each with the opening it reached, and whether older ones match too. */
export async function gameListView(store: Store, now: number, filter: Omit<GameFilter, "shownBy">) {
  const rows = await store.listGames({ ...filter, shownBy: now, limit: filter.limit + 1 });
  const page = rows.slice(0, filter.limit);
  const moves = await store.openingMoves(OPENING_NAME_PLIES, now, page.map((g) => g.id));
  return {
    games: page.map((g) => {
      const opening = classifyOpening(moves.get(g.id) ?? []);
      return { ...gameView(g), opening: opening && { eco: opening.eco, name: opening.name } };
    }),
    more: rows.length > filter.limit,
  };
}
