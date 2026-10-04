import { START_RATING } from "./elo";

export type Side = "jev" | "opp";
export type Result = "1-0" | "0-1" | "1/2-1/2";

export interface Ladder {
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  currentGameId: number | null;
  /** When the next ply may be shown to viewers (ms epoch). Plies are paced forward from here. */
  nextShowAt: number;
  jevCalls: number;
  jevTokens: number;
  /** Games up to this id have been learned from. Missing on ladders from before memory existed. */
  memoryUpTo?: number;
  /** Format the learned memory is in; a mismatch relearns from every game. */
  memoryVersion?: number;
}

export interface GameRow {
  id: number;
  jevColor: "w" | "b";
  oppElo: number;
  ratingBefore: number;
  ratingAfter: number | null;
  result: Result | null;
  termination: string | null;
  plies: number;
  startedAt: number;
  /** When the final ply is shown, so viewers never see a result before the moves. */
  endedShowAt: number | null;
}

export interface PlyRow {
  gameId: number;
  ply: number;
  side: Side;
  san: string;
  uci: string;
  fen: string;
  showAt: number;
  data: unknown;
}

export interface Store {
  init(): Promise<void>;
  /** Takes the runner lease if it is free or expired. Returns false when another tick holds it. */
  tryLease(owner: string, now: number, until: number): Promise<boolean>;
  releaseLease(owner: string): Promise<void>;
  getLadder(): Promise<Ladder>;
  saveLadder(ladder: Ladder): Promise<void>;
  createGame(game: Omit<GameRow, "id">): Promise<number>;
  getGame(id: number): Promise<GameRow | null>;
  updateGame(game: GameRow): Promise<void>;
  addPly(ply: PlyRow): Promise<void>;
  getPlies(gameId: number): Promise<PlyRow[]>;
  recentGames(limit: number, shownBy: number): Promise<GameRow[]>;
  /** The newest game whose first ply viewers can already see. */
  shownGame(shownBy: number): Promise<GameRow | null>;
  shownPlies(gameId: number, afterPly: number, shownBy: number): Promise<PlyRow[]>;
  /** The first ply viewers can't see yet, so the page can count down to it. */
  nextShowAt(shownBy: number): Promise<number | null>;
  /** Finished games viewers have seen, oldest first, for the record and rating chart. */
  shownHistory(shownBy: number): Promise<GameRow[]>;
  /** The first `plies` moves (SAN) of each finished game viewers have seen, keyed by game id. */
  openingMoves(plies: number, shownBy: number): Promise<Map<number, string[]>>;
  /** Records that a viewer's page is open, and drops long-gone viewers. */
  touchViewer(id: string, now: number): Promise<void>;
  countViewers(since: number): Promise<number>;
}

export const newLadder = (now: number): Ladder => ({
  rating: START_RATING,
  games: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  currentGameId: null,
  nextShowAt: now,
  jevCalls: 0,
  jevTokens: 0,
});

// In-memory store for tests and local runs.
export class MemoryStore implements Store {
  private ladder: Ladder | null = null;
  private lease: { owner: string; until: number } | null = null;
  private games: GameRow[] = [];
  private plies: PlyRow[] = [];
  private viewers = new Map<string, number>();

  async init() {}

  async tryLease(owner: string, now: number, until: number) {
    if (this.lease && this.lease.until > now && this.lease.owner !== owner) return false;
    this.lease = { owner, until };
    return true;
  }

  async releaseLease(owner: string) {
    if (this.lease?.owner === owner) this.lease = null;
  }

  async getLadder() {
    return { ...(this.ladder ?? newLadder(Date.now())) };
  }

  async saveLadder(ladder: Ladder) {
    this.ladder = { ...ladder };
  }

  async createGame(game: Omit<GameRow, "id">) {
    const id = this.games.length + 1;
    this.games.push({ ...game, id });
    return id;
  }

  async getGame(id: number) {
    const g = this.games.find((x) => x.id === id);
    return g ? { ...g } : null;
  }

  async updateGame(game: GameRow) {
    this.games = this.games.map((g) => (g.id === game.id ? { ...game } : g));
  }

  async addPly(ply: PlyRow) {
    this.plies.push(ply);
  }

  async getPlies(gameId: number) {
    return this.plies.filter((p) => p.gameId === gameId).sort((a, b) => a.ply - b.ply);
  }

  async recentGames(limit: number, shownBy: number) {
    return this.games
      .filter((g) => g.endedShowAt !== null && g.endedShowAt <= shownBy)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  async shownGame(shownBy: number) {
    return [...this.games].reverse().find((g) => g.startedAt <= shownBy) ?? null;
  }

  async shownPlies(gameId: number, afterPly: number, shownBy: number) {
    return (await this.getPlies(gameId)).filter((p) => p.ply > afterPly && p.showAt <= shownBy);
  }

  async touchViewer(id: string, now: number) {
    this.viewers.set(id, now);
  }

  async countViewers(since: number) {
    return [...this.viewers.values()].filter((t) => t >= since).length;
  }

  async shownHistory(shownBy: number) {
    return (await this.recentGames(Number.MAX_SAFE_INTEGER, shownBy)).reverse();
  }

  async openingMoves(plies: number, shownBy: number) {
    const out = new Map<number, string[]>();
    for (const g of await this.shownHistory(shownBy)) {
      out.set(g.id, (await this.getPlies(g.id)).filter((p) => p.ply < plies).map((p) => p.san));
    }
    return out;
  }

  async nextShowAt(shownBy: number) {
    const next = this.plies.filter((p) => p.showAt > shownBy).sort((a, b) => a.showAt - b.showAt)[0];
    return next?.showAt ?? null;
  }
}
