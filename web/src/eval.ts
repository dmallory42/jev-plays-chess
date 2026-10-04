// Stockfish in a Web Worker, for viewers only: the evaluation bar and move ratings. Jev never sees any of it.

export interface Evaluation {
  /** Centipawns from White's point of view. */
  cp?: number;
  /** Moves to mate from White's point of view (negative: Black mates). 0 means the side to move is checkmated. */
  mate?: number;
  depth: number;
  whiteToMove: boolean;
}

export interface Line {
  /** First move of the line, in UCI. Empty when the position is already over. */
  uci: string;
  eval: Evaluation;
}

export interface Analysis {
  fen: string;
  depth: number;
  /** Best first, one per MultiPV line. */
  lines: Line[];
}

interface Job {
  fen: string;
  depth: number;
  multipv: number;
  searchmoves?: string[];
  key: string;
  /** 0 urgent (the bar), 1 soon (the options on screen), 2 background (the whole game). */
  rank: 0 | 1 | 2;
  onInfo?: (e: Evaluation) => void;
  resolve: (a: Analysis) => void;
}

const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

function parseScore(line: string, whiteToMove: boolean, depth: number): Evaluation | null {
  const score = / score (cp|mate) (-?\d+)/.exec(line);
  if (!score) return null;
  const sign = whiteToMove ? 1 : -1;
  const value = Number(score[2]);
  return score[1] === "cp" ? { cp: value * sign, depth, whiteToMove } : { mate: value * sign, depth, whiteToMove };
}

// One engine, one job at a time. Urgent jobs (the bar) jump the queue and cut short a running urgent job.
export class Engine {
  private worker: Worker | null = null;
  private ready = false;
  private queue: Job[] = [];
  private running: (Job & { lines: Map<number, Line>; depthSeen: number }) | null = null;
  private cache = new Map<string, Analysis>();
  private inflight = new Map<string, Promise<Analysis>>();

  analyse(fen: string, opts: { depth: number; multipv?: number; searchmoves?: string[]; rank?: 0 | 1 | 2; onInfo?: (e: Evaluation) => void }): Promise<Analysis> {
    const rank = opts.rank ?? 2;
    const multipv = opts.multipv ?? 1;
    const key = `${fen}|${opts.depth}|${multipv}|${opts.searchmoves?.join(",") ?? ""}`;
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.lines[0]) opts.onInfo?.(cached.lines[0].eval);
      return Promise.resolve(cached);
    }
    const existing = this.inflight.get(key);
    if (existing && rank !== 0) return existing;

    const promise = new Promise<Analysis>((resolve) => {
      const job: Job = { fen, depth: opts.depth, multipv, searchmoves: opts.searchmoves, key, rank, onInfo: opts.onInfo, resolve };
      if (rank === 0) {
        // Only the newest urgent job matters; drop older queued ones and stop a running one.
        for (const j of this.queue.filter((q) => q.rank === 0)) j.resolve({ fen: j.fen, depth: 0, lines: [] });
        this.queue = this.queue.filter((q) => q.rank !== 0);
        if (this.running?.rank === 0) this.worker?.postMessage("stop");
      }
      const at = this.queue.findIndex((q) => q.rank > rank);
      if (at === -1) this.queue.push(job);
      else this.queue.splice(at, 0, job);
    });
    this.inflight.set(key, promise);
    promise.finally(() => this.inflight.delete(key));
    this.start();
    this.pump();
    return promise;
  }

  /** Drops queued background work, for example after switching to another game. */
  clearBackground() {
    for (const j of this.queue.filter((q) => q.rank === 2)) j.resolve({ fen: j.fen, depth: 0, lines: [] });
    this.queue = this.queue.filter((q) => q.rank !== 2);
  }

  private start() {
    if (this.worker) return;
    try {
      this.worker = new Worker(ENGINE_URL);
    } catch {
      return;
    }
    this.worker.onmessage = (e: MessageEvent<string>) => this.onLine(String(e.data));
    this.worker.postMessage("uci");
    this.worker.postMessage("isready");
  }

  private pump() {
    if (!this.ready || this.running || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = { ...job, lines: new Map(), depthSeen: 0 };
    this.worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go depth ${job.depth}${job.searchmoves?.length ? ` searchmoves ${job.searchmoves.join(" ")}` : ""}`);
  }

  private onLine(line: string) {
    if (line === "readyok") {
      this.ready = true;
      this.pump();
      return;
    }
    const job = this.running;
    if (!job) return;
    if (line.startsWith("bestmove")) {
      const result: Analysis = { fen: job.fen, depth: job.depthSeen, lines: [...job.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l) };
      // A search cut short isn't worth caching.
      if (job.depthSeen >= job.depth || result.lines[0]?.eval.mate !== undefined) this.cache.set(job.key, result);
      this.running = null;
      job.resolve(result);
      this.pump();
      return;
    }
    if (!line.startsWith("info") || !line.includes(" score ")) return;
    const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
    const pv = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
    const whiteToMove = job.fen.split(" ")[1] === "w";
    const e = parseScore(line, whiteToMove, depth);
    if (!e) return;
    const uci = / pv (\S+)/.exec(line)?.[1] ?? "";
    job.lines.set(pv, { uci, eval: e });
    job.depthSeen = Math.max(job.depthSeen, depth);
    if (pv === 1 && (depth >= 8 || e.mate !== undefined)) job.onInfo?.(e);
  }
}

// Share of the bar that is White's, 0 to 1. Same curve Lichess uses for its bar.
export function whiteShare(e: Evaluation) {
  if (e.mate !== undefined) {
    if (e.mate === 0) return e.whiteToMove ? 0 : 1;
    return e.mate > 0 ? 1 : 0;
  }
  return 1 / (1 + Math.exp(-0.00368208 * (e.cp ?? 0)));
}

/** Winning chances for one side, 0 to 100. */
export const winChance = (e: Evaluation, side: "w" | "b") => (side === "w" ? whiteShare(e) : 1 - whiteShare(e)) * 100;

export function scoreLabel(e: Evaluation) {
  // Checkmate on the board: show the result rather than a mate count.
  if (e.mate !== undefined) return e.mate === 0 ? (e.whiteToMove ? "0-1" : "1-0") : `M${Math.abs(e.mate)}`;
  const pawns = (e.cp ?? 0) / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}
