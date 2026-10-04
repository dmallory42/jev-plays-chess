import type { Memory, OpeningRecord, Pattern } from "./memory";
import { newLadder, type GameRow, type Ladder, type PlyRow, type Store } from "./store";

// A D1-style database binding. Hosts that provide one (Spacefast, Cloudflare) pass it straight
// in; anything else wraps its driver, as deploy/node does for SQLite.
export interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): D1Statement } & D1Statement;
}
interface D1Statement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

// MySQL and SQLite differ only in index declarations and upserts here.
export type Dialect = "mysql" | "sqlite";

const INDEXES: Record<string, [name: string, column: string][]> = {
  plies: [["plies_show_at", "show_at"]],
  viewers: [["viewers_seen", "seen"]],
};

// MySQL takes the indexes inside CREATE TABLE (it has no CREATE INDEX IF NOT EXISTS); SQLite needs them separately.
function schema(dialect: Dialect) {
  const tables = TABLES.map(([table, columns]) => {
    const inline = dialect === "mysql" ? (INDEXES[table] ?? []).map(([name, col]) => `,\n    INDEX ${name} (${col})`).join("") : "";
    return `CREATE TABLE IF NOT EXISTS ${table} (${columns}${inline}\n  )`;
  });
  if (dialect === "mysql") return tables;
  const indexes = Object.entries(INDEXES).flatMap(([table, list]) => list.map(([name, col]) => `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${col})`));
  return [...tables, ...indexes];
}

// Insert, or update the existing row on a key clash. In `updates`, new.<column> is the value being inserted.
function upsert(dialect: Dialect, insert: string, key: string, updates: string) {
  return dialect === "mysql"
    ? `${insert} ON DUPLICATE KEY UPDATE ${updates.replace(/new\.(\w+)/g, "VALUES($1)")}`
    : `${insert} ON CONFLICT(${key}) DO UPDATE SET ${updates.replace(/new\.(\w+)/g, "excluded.$1")}`;
}

const TABLES: [table: string, columns: string][] = [
  ["ladder", `
    id TINYINT PRIMARY KEY,
    data TEXT NOT NULL,
    lease_owner VARCHAR(64) NULL,
    lease_until BIGINT NOT NULL DEFAULT 0`],
  ["games", `
    id INT PRIMARY KEY,
    jev_color CHAR(1) NOT NULL,
    opp_elo INT NOT NULL,
    rating_before DOUBLE NOT NULL,
    rating_after DOUBLE NULL,
    result VARCHAR(8) NULL,
    termination VARCHAR(64) NULL,
    plies INT NOT NULL,
    started_at BIGINT NOT NULL,
    ended_show_at BIGINT NULL`],
  ["plies", `
    game_id INT NOT NULL,
    ply INT NOT NULL,
    side VARCHAR(3) NOT NULL,
    san VARCHAR(10) NOT NULL,
    uci VARCHAR(5) NOT NULL,
    fen VARCHAR(100) NOT NULL,
    show_at BIGINT NOT NULL,
    data MEDIUMTEXT NOT NULL,
    PRIMARY KEY (game_id, ply)`],
  ["patterns", `
    pkey VARCHAR(64) PRIMARY KEY,
    text TEXT NOT NULL,
    played INT NOT NULL,
    wrong INT NOT NULL,
    last_game INT NOT NULL`],
  ["openings", `
    okey VARCHAR(160) PRIMARY KEY,
    games INT NOT NULL,
    points DOUBLE NOT NULL`],
  ["viewers", `
    id VARCHAR(40) PRIMARY KEY,
    seen BIGINT NOT NULL`],
];

type GameDb = {
  id: number;
  jev_color: "w" | "b";
  opp_elo: number;
  rating_before: number;
  rating_after: number | null;
  result: GameRow["result"];
  termination: string | null;
  plies: number;
  started_at: number;
  ended_show_at: number | null;
};
type PlyDb = { game_id: number; ply: number; side: PlyRow["side"]; san: string; uci: string; fen: string; show_at: number; data: string };

type PatternDb = { pkey: string; text: string; played: number; wrong: number; last_game: number };
const toPattern = (r: PatternDb): Pattern => ({ key: r.pkey, text: r.text, played: Number(r.played), wrong: Number(r.wrong), lastGame: Number(r.last_game) });

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toGame = (r: GameDb): GameRow => ({
  id: Number(r.id),
  jevColor: r.jev_color,
  oppElo: Number(r.opp_elo),
  ratingBefore: Number(r.rating_before),
  ratingAfter: num(r.rating_after),
  result: r.result,
  termination: r.termination,
  plies: Number(r.plies),
  startedAt: Number(r.started_at),
  endedShowAt: num(r.ended_show_at),
});
const toPly = (r: PlyDb): PlyRow => ({
  gameId: Number(r.game_id),
  ply: Number(r.ply),
  side: r.side,
  san: r.san,
  uci: r.uci,
  fen: r.fen,
  showAt: Number(r.show_at),
  data: JSON.parse(r.data),
});

export class SqlStore implements Store, Memory {
  constructor(
    private db: D1Like,
    private dialect: Dialect = "mysql",
  ) {}

  async init() {
    for (const sql of schema(this.dialect)) await this.db.prepare(sql).run();
    await this.db.prepare(upsert(this.dialect, "INSERT INTO ladder (id, data) VALUES (1, ?)", "id", "id = id")).bind(JSON.stringify(newLadder(Date.now()))).run();
  }

  // Conditional update, then read back who owns it. Doesn't rely on affected-row counts.
  async tryLease(owner: string, now: number, until: number) {
    await this.db
      .prepare("UPDATE ladder SET lease_owner = ?, lease_until = ? WHERE id = 1 AND (lease_until < ? OR lease_owner = ?)")
      .bind(owner, until, now, owner)
      .run();
    const row = await this.db.prepare("SELECT lease_owner FROM ladder WHERE id = 1").first<{ lease_owner: string | null }>();
    return row?.lease_owner === owner;
  }

  async releaseLease(owner: string) {
    await this.db.prepare("UPDATE ladder SET lease_until = 0 WHERE id = 1 AND lease_owner = ?").bind(owner).run();
  }

  async getLadder(): Promise<Ladder> {
    const row = await this.db.prepare("SELECT data FROM ladder WHERE id = 1").first<{ data: string }>();
    return row ? JSON.parse(row.data) : newLadder(Date.now());
  }

  async saveLadder(ladder: Ladder) {
    await this.db.prepare("UPDATE ladder SET data = ? WHERE id = 1").bind(JSON.stringify(ladder)).run();
  }

  // Ids are assigned here rather than by AUTO_INCREMENT; only the lease holder writes.
  async createGame(g: Omit<GameRow, "id">) {
    const row = await this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM games").first<{ id: number }>();
    const id = Number(row?.id ?? 1);
    await this.db
      .prepare("INSERT INTO games (id, jev_color, opp_elo, rating_before, rating_after, result, termination, plies, started_at, ended_show_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, g.jevColor, g.oppElo, g.ratingBefore, g.ratingAfter, g.result, g.termination, g.plies, g.startedAt, g.endedShowAt)
      .run();
    return id;
  }

  async getGame(id: number) {
    const r = await this.db.prepare("SELECT * FROM games WHERE id = ?").bind(id).first<GameDb>();
    return r ? toGame(r) : null;
  }

  async updateGame(g: GameRow) {
    await this.db
      .prepare("UPDATE games SET rating_after = ?, result = ?, termination = ?, plies = ?, ended_show_at = ? WHERE id = ?")
      .bind(g.ratingAfter, g.result, g.termination, g.plies, g.endedShowAt, g.id)
      .run();
  }

  async addPly(p: PlyRow) {
    await this.db
      .prepare("INSERT INTO plies (game_id, ply, side, san, uci, fen, show_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(p.gameId, p.ply, p.side, p.san, p.uci, p.fen, p.showAt, JSON.stringify(p.data))
      .run();
  }

  async getPlies(gameId: number) {
    const { results } = await this.db.prepare("SELECT * FROM plies WHERE game_id = ? ORDER BY ply").bind(gameId).all<PlyDb>();
    return results.map(toPly);
  }

  async recentGames(limit: number, shownBy: number) {
    const { results } = await this.db
      .prepare("SELECT * FROM games WHERE ended_show_at IS NOT NULL AND ended_show_at <= ? ORDER BY id DESC LIMIT ?")
      .bind(shownBy, limit)
      .all<GameDb>();
    return results.map(toGame);
  }

  async shownGame(shownBy: number) {
    const r = await this.db.prepare("SELECT * FROM games WHERE started_at <= ? ORDER BY id DESC LIMIT 1").bind(shownBy).first<GameDb>();
    return r ? toGame(r) : null;
  }

  async shownPlies(gameId: number, afterPly: number, shownBy: number) {
    const { results } = await this.db
      .prepare("SELECT * FROM plies WHERE game_id = ? AND ply > ? AND show_at <= ? ORDER BY ply")
      .bind(gameId, afterPly, shownBy)
      .all<PlyDb>();
    return results.map(toPly);
  }

  async patterns(keys: string[]) {
    const out: Record<string, Pattern> = {};
    if (!keys.length) return out;
    const { results } = await this.db
      .prepare(`SELECT * FROM patterns WHERE pkey IN (${keys.map(() => "?").join(", ")})`)
      .bind(...keys)
      .all<PatternDb>();
    for (const r of results) out[r.pkey] = toPattern(r);
    return out;
  }

  async allPatterns(minPlayed: number, limit: number) {
    const { results } = await this.db
      .prepare("SELECT * FROM patterns WHERE played >= ? ORDER BY wrong * 1.0 / played DESC, played DESC LIMIT ?")
      .bind(minPlayed, limit)
      .all<PatternDb>();
    return results.map(toPattern);
  }

  async addPatterns(moves: { key: string; text: string; wrong: boolean }[], gameId: number) {
    for (const m of moves) {
      await this.db
        .prepare(
          upsert(
            this.dialect,
            "INSERT INTO patterns (pkey, text, played, wrong, last_game) VALUES (?, ?, 1, ?, ?)",
            "pkey",
            "played = played + 1, wrong = wrong + new.wrong, text = new.text, last_game = new.last_game",
          ),
        )
        .bind(m.key, m.text, m.wrong ? 1 : 0, gameId)
        .run();
    }
  }

  async reset() {
    await this.db.prepare("DELETE FROM patterns").run();
    await this.db.prepare("DELETE FROM openings").run();
  }

  async openings(keys: string[]) {
    const out: Record<string, OpeningRecord> = {};
    if (!keys.length) return out;
    const { results } = await this.db
      .prepare(`SELECT okey, games, points FROM openings WHERE okey IN (${keys.map(() => "?").join(", ")})`)
      .bind(...keys)
      .all<{ okey: string; games: number; points: number }>();
    for (const r of results) out[r.okey] = { games: Number(r.games), points: Number(r.points) };
    return out;
  }

  async allOpenings(minGames: number, limit: number) {
    const { results } = await this.db
      .prepare("SELECT okey, games, points FROM openings WHERE games >= ? ORDER BY games DESC LIMIT ?")
      .bind(minGames, limit)
      .all<{ okey: string; games: number; points: number }>();
    return results.map((r) => ({ key: r.okey, games: Number(r.games), points: Number(r.points) }));
  }

  async addOpenings(keys: string[], points: number) {
    for (const k of keys) {
      await this.db
        .prepare(upsert(this.dialect, "INSERT INTO openings (okey, games, points) VALUES (?, 1, ?)", "okey", "games = games + 1, points = points + new.points"))
        .bind(k, points)
        .run();
    }
  }

  async touchViewer(id: string, now: number) {
    await this.db.prepare(upsert(this.dialect, "INSERT INTO viewers (id, seen) VALUES (?, ?)", "id", "seen = new.seen")).bind(id, now).run();
    // Occasional cleanup keeps the table small without a separate job.
    if (Math.random() < 0.02) await this.db.prepare("DELETE FROM viewers WHERE seen < ?").bind(now - 3_600_000).run();
  }

  async countViewers(since: number) {
    const r = await this.db.prepare("SELECT COUNT(*) AS n FROM viewers WHERE seen >= ?").bind(since).first<{ n: number }>();
    return Number(r?.n ?? 0);
  }

  async shownHistory(shownBy: number) {
    const { results } = await this.db
      .prepare("SELECT * FROM games WHERE ended_show_at IS NOT NULL AND ended_show_at <= ? ORDER BY id")
      .bind(shownBy)
      .all<GameDb>();
    return results.map(toGame);
  }

  async openingMoves(plies: number, shownBy: number) {
    const { results } = await this.db
      .prepare(
        "SELECT p.game_id, p.san FROM plies p JOIN games g ON g.id = p.game_id WHERE g.ended_show_at IS NOT NULL AND g.ended_show_at <= ? AND p.ply < ? ORDER BY p.game_id, p.ply",
      )
      .bind(shownBy, plies)
      .all<{ game_id: number; san: string }>();
    const out = new Map<number, string[]>();
    for (const r of results) {
      const id = Number(r.game_id);
      const list = out.get(id) ?? [];
      list.push(r.san);
      out.set(id, list);
    }
    return out;
  }

  async nextShowAt(shownBy: number) {
    const r = await this.db.prepare("SELECT MIN(show_at) AS t FROM plies WHERE show_at > ?").bind(shownBy).first<{ t: number | null }>();
    return num(r?.t);
  }
}
