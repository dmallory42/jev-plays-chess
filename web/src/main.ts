import "./theme";
import { drawArrows, drawBoard, drawHeat, type Arrow } from "./board";
import { nag, rate, type Rating } from "./annotate";
import { Engine, scoreLabel, whiteShare, type Evaluation } from "./eval";
import { captures } from "./material";
import { figurine, icon, pieceIcon, tagChips, type Colour, type PieceType, type Tag } from "./notation";

interface Option {
  san: string;
  uci: string;
  p: number;
  tags?: Tag[];
}
interface JevData {
  confidence: number;
  legal: number;
  top: Option[];
  /** Material and threats before the move, from Jev's side. Missing on early games. */
  before?: { material: number; inCheck: boolean; threatened: { piece: PieceType; square: string; n: number }[] };
  /** Jev's answer to "should you resign?", 0 to 1. Missing on early games. */
  resign?: number;
  /** What Jev was reminded of, per move (SAN): kinds of move that often went wrong, and its opening record. */
  remembered?: { history: Record<string, string>; openings: Record<string, string> };
  /** Jev played one of its other options to learn about this opening, instead of its top pick. */
  explored?: boolean;
  latencyMs: number;
  tokens: number;
}
interface OppData {
  top: { san: string; uci: string; p: number }[];
  /** Maia's own win/draw/loss estimate from its side. Missing on early games. */
  value?: { win: number; draw: number; loss: number };
}
interface Ply {
  ply: number;
  side: "jev" | "opp";
  san: string;
  uci: string;
  fen: string;
  showAt: number;
  data: JevData | OppData;
}
interface Game {
  id: number;
  jevColor: "w" | "b";
  oppElo: number;
  ratingBefore: number;
  ratingAfter: number | null;
  result: string | null;
  termination: string | null;
  plies: number;
  opening?: { eco: string; name: string } | null;
}
interface Live {
  now: number;
  watching: number;
  game: Game | null;
  plies: Ply[];
  nextShowAt: number | null;
}
interface Summary {
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  history: { id: number; rating: number; oppElo: number; score: number; jevColor: "w" | "b" }[];
  recent: Game[];
}
/** What the board shows: the live game, or a game being stepped through at `cursor` plies. */
type View = { kind: "live" } | { kind: "review"; game: Game; plies: Ply[]; cursor: number; loading?: boolean };

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// How long Jev's options are shown on the board before its piece moves. The server leaves the same time
// (jevThinkMs in src/server/app.ts) before Maia's reply.
const THINK_MS = 2200;
const POLL_MS = 1500;
const CHECK_IN_MS = 10_000;

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const board = $<SVGSVGElement>("board");
const engine = new Engine();
// Depth for move ratings: quick enough to run through a whole game in the background.
const RATE_DEPTH = 12;
const ratings = new Map<string, Rating>();
const optionRatings = new Map<string, Map<string, Rating>>();
const requested = new Set<string>();
if (import.meta.env.DEV) Object.assign(window, { engine, ratings });
let analysingGame: number | null = null;
let panelKey: string | null = null;
let nagsFrame = 0;
const viewerId = (() => {
  try {
    const saved = sessionStorage.getItem("viewer");
    if (saved) return saved;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
    sessionStorage.setItem("viewer", id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
})();

let liveGame: Game | null = null;
let livePlies: Ply[] = [];
let view: View = { kind: "live" };
let thinkingTimer: number | undefined;
let lastTickNudge = 0;
let lastCheckIn = 0;
let lastSummaryAt = 0;
let bannerShownFor: number | null = null;
const gameCache = new Map<number, Promise<{ game: Game; plies: Ply[] }>>();
let recentGames: Game[] = [];
// The games list: what's loaded so far under the chosen filter, and whether older games match too.
let listedGames: Game[] = [];
let listFilter = "";
let listHasMore = false;
let listNewest = 0;
let listRequest = 0;

// Starts loading a finished game (once), for clicks, hovers and idle prefetching.
function fetchGame(id: number) {
  let p = gameCache.get(id);
  if (!p) {
    p = getJson<{ game: Game; plies: Ply[] }>(`/api/games/${id}`);
    p.catch(() => gameCache.delete(id));
    gameCache.set(id, p);
  }
  return p;
}

const isJev = (p: Ply | undefined): p is Ply & { data: JevData } => p?.side === "jev";
const pct = (p: number) => `${Math.round(p * 100)}%`;
const colourName = (c: "w" | "b") => (c === "w" ? "White" : "Black");
const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const moveLabel = (p: Ply) => `${moveNo(p.ply)}${p.ply % 2 === 0 ? "." : "..."} ${p.san}`;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lastMoveOf = (p: Ply | undefined) => (p ? { from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), side: p.side } : null);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

// The game, its moves and how many of them are on the board, for whichever view is active.
function current() {
  if (view.kind === "review") return { game: view.game, plies: view.plies, cursor: view.cursor, live: false };
  return { game: liveGame, plies: livePlies, cursor: livePlies.length, live: true };
}

// Nudges the server to compute more moves when the buffer runs low. Pacing on the server caps the cost.
function maybeNudge(live: Live) {
  if (document.hidden) return;
  const low = live.nextShowAt === null || live.nextShowAt - live.now < 25_000;
  if (!low || Date.now() - lastTickNudge < 15_000) return;
  lastTickNudge = Date.now();
  fetch("/api/tick", { method: "POST" }).catch(() => {});
}

function renderPlayers() {
  const { game, cursor, live } = current();
  const top = $("player-top");
  const bottom = $("player-bottom");
  if (!game) {
    top.innerHTML = "";
    bottom.innerHTML = "";
    return;
  }
  const toMove = cursor % 2 === 0 ? "w" : "b";
  const oppColour = game.jevColor === "w" ? "b" : "w";
  const over = game.result !== null && (live || cursor === game.plies);
  const { taken, balance } = captures(current().plies[cursor - 1]?.fen ?? START_FEN);
  // The pieces a side has taken are in its opponent's colour; the side ahead also shows by how much.
  const material = (colour: Colour) => {
    const ahead = colour === "w" ? balance : -balance;
    const icons = taken[colour].map((t) => pieceIcon(colour === "w" ? "b" : "w", t, `pc captured-${t}`)).join("");
    return `<span class="captured">${icons}</span>${ahead > 0 ? `<span class="material-ahead" title="Ahead by ${ahead} in material">+${ahead}</span>` : ""}`;
  };
  const strip = (name: string, cls: string, colour: Colour, rating: number) =>
    `<span class="swatch ${colour}" title="${colour === "w" ? "White" : "Black"}"></span><span class="player-name ${cls}">${name}</span><span class="player-meta">${rating}</span>${!over && toMove === colour ? `<span class="to-move-dot" title="To move"></span>` : ""}${material(colour)}`;
  top.innerHTML = strip("Maia", "is-maia", oppColour, game.oppElo);
  bottom.innerHTML = strip("Jev", "is-jev", game.jevColor, Math.round(game.ratingBefore));
}

// Where Jev's options would land, for the heat map.
const heatFor = (ply: Ply & { data: JevData }) => ply.data.top.filter((o) => o.uci).map((o) => ({ to: o.uci.slice(2, 4), p: o.p }));

function arrowsFor(ply: Ply & { data: JevData }, onlyChosen: boolean): Arrow[] {
  return ply.data.top
    .filter((o) => o.p >= 0.03 && o.uci)
    .slice(0, 5)
    .map((o) => ({ from: o.uci.slice(0, 2), to: o.uci.slice(2, 4), weight: o.p, chosen: o.san === ply.san }))
    .filter((a) => !onlyChosen || a.chosen);
}

// Mirrors RESIGN_AT in src/core/runner.ts.
const RESIGN_AT_JEV = 0.7;
const RESIGN_AT_MAIA = 0.9;
const metaTile = (label: string, value: string, title: string, cls = "") =>
  `<li class="${cls}" title="${title}"><span class="meta-label">${label}</span><span class="meta-value">${value}</span></li>`;
const resignMeta = (v: number, at: number, what: string) =>
  metaTile("Resign", v.toFixed(2), `${what} ${v.toFixed(2)}. Resigns at ${at.toFixed(2)} or more on two turns running.`, v >= at ? "resign-high" : "");

const moverOf = (p: Ply): Colour => (p.ply % 2 === 0 ? "w" : "b");
const moveNumberLabel = (p: Ply) => `Move ${moveNo(p.ply)}${p.ply % 2 ? ", Black" : ""}`;

// Memory chips: a warning when moves of this kind keep going wrong, and Jev's opening record.
function memoryChips(san: string, remembered: JevData["remembered"]) {
  const out: string[] = [];
  const history = remembered?.history[san];
  if (history) {
    const m = /(\d+) of your last (\d+)/.exec(history);
    out.push(`<li class="chip bad" title="Jev remembers: ${history}"><span class="sr">Jev remembers: ${history}</span><span aria-hidden="true" class="chip-body">${icon("memory")}${m ? `${m[1]}/${m[2]}` : "!"}</span></li>`);
  }
  const record = remembered?.openings[san];
  if (record) {
    const pct = Number(/scored (\d+)%/.exec(record)?.[1] ?? 50);
    out.push(`<li class="chip ${pct >= 55 ? "good" : pct <= 45 ? "bad" : "quiet"}" title="Jev's opening record: ${record}"><span class="sr">Opening record: ${record}</span><span aria-hidden="true" class="chip-body">${icon("book")}${pct}%</span></li>`);
  }
  return out.join("");
}

function renderOptions(options: { san: string; uci?: string; p: number; tags?: Tag[] }[], chosen: string | null, mover: Colour, forMaia: boolean, remembered?: JevData["remembered"]) {
  const list = $("options");
  list.innerHTML = options
    .map(
      (o) => `<li class="option ${forMaia ? "for-maia" : ""} ${o.san === chosen ? "is-chosen" : ""}" ${o.uci ? `data-uci="${o.uci}"` : ""}>
        <span class="option-san">${figurine(o.san, mover)}<span class="nag-slot"></span></span>
        <span class="option-bar"><span class="option-fill" data-w="${(o.p * 100).toFixed(1)}"></span></span>
        <span class="option-p">${pct(o.p)}</span>
        <ul class="chips">${memoryChips(o.san, remembered)}${tagChips(o.tags, mover)}</ul>
      </li>`,
    )
    .join("");
  // Bars grow from zero each time a new decision is shown.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => list.querySelectorAll<HTMLElement>(".option-fill").forEach((el) => (el.style.width = `${el.dataset.w}%`))),
  );
}

function materialChip(n: number) {
  if (n === 0) return `<li class="chip quiet" title="Material is level"><span class="sr">Material is level</span><span aria-hidden="true" class="chip-body">=</span></li>`;
  const title = n > 0 ? `Jev is ahead by ${n} in material` : `Jev is behind by ${-n} in material`;
  return `<li class="chip ${n > 0 ? "good" : "bad"}" title="${title}"><span class="sr">${title}</span><span aria-hidden="true" class="chip-body">${n > 0 ? "+" : "−"}${Math.abs(n)}</span></li>`;
}

// The panel: the move (notation, what it did, what was at stake) above the options that were weighed.
function renderMind(ply: Ply | undefined, thinking: boolean) {
  const { game } = current();
  const san = $("move-san");
  const weighed = $("weighed");
  const before = $("before");
  san.className = "move-san";
  $("move-chips").innerHTML = "";
  $("move-nag").innerHTML = "";
  panelKey = ply && game ? `${game.id}:${ply.ply}` : null;
  before.hidden = true;

  if (!ply) {
    const loading = view.kind === "review" && view.loading;
    $("move-no").textContent = view.kind === "review" && !loading ? "Start of the game" : "";
    san.classList.add("is-idle");
    san.textContent = loading ? "Loading…" : view.kind === "review" ? "Step forward to replay" : game ? "First move coming" : "Waiting for the next game";
    weighed.hidden = true;
    return;
  }

  const mover = moverOf(ply);
  $("move-no").textContent = moveNumberLabel(ply);
  weighed.hidden = false;

  if (!isJev(ply)) {
    const d = ply.data as OppData;
    san.classList.add("for-maia");
    san.innerHTML = figurine(ply.san, mover);
    $("weighed-title").textContent = "Maia's likely moves";
    $("weighed-meta").innerHTML = d.value ? resignMeta(d.value.loss, RESIGN_AT_MAIA, "Maia's estimate that it's losing") : "";
    renderOptions(d.top.map((o) => ({ san: o.san, p: o.p })), ply.san, mover, true);
    return;
  }

  const d = ply.data;
  const chosen = d.top.find((o) => o.san === ply.san);
  if (thinking) {
    san.classList.add("is-idle");
    san.textContent = "Choosing…";
  } else {
    san.innerHTML = figurine(ply.san, mover);
    const exploring = d.explored
      ? `<li class="chip explore" title="Jev tried one of its other options instead of its top pick, to learn how this opening goes">Exploring</li>`
      : "";
    $("move-chips").innerHTML = exploring + tagChips(chosen?.tags, mover);
  }
  if (d.before) {
    const threats = d.before.threatened
      .map((t) => {
        const title = `The ${t.square} piece was under attack (−${t.n})`;
        return `<li class="chip bad" title="${title}"><span class="sr">${title}</span><span aria-hidden="true" class="chip-body">${icon("warn")}${pieceIcon(mover, t.piece)}${t.square}</span></li>`;
      })
      .join("");
    $("before-chips").innerHTML = materialChip(d.before.material) + threats;
    before.hidden = false;
  }
  $("weighed-title").textContent = "Options";
  $("weighed-meta").innerHTML = [
    metaTile("Confidence", `${d.confidence.toFixed(2)}<span class="meta-conf"><span style="width:${d.confidence * 100}%"></span></span>`, "Confidence: how concentrated Jev's probabilities are"),
    d.resign !== undefined ? resignMeta(d.resign, RESIGN_AT_JEV, "Jev's answer to: should I resign?") : "",
    metaTile("Legal moves", String(d.legal), "Legal moves in the position"),
    metaTile("Time", `${(d.latencyMs / 1000).toFixed(1)}s`, "Time Jev took"),
  ].join("");
  renderOptions(
    d.top.filter((o, i) => i < 5 && (o.p >= 0.01 || i < 3)),
    thinking ? null : ply.san,
    mover,
    false,
    d.remembered,
  );
  if (game) queueOptionRatings(game, current().plies, ply);
  scheduleNags();
}

function renderScoresheet() {
  const { game, plies, cursor, live } = current();
  const rows: string[] = [];
  for (let i = 0; i < plies.length; i += 2) {
    const cell = (p: Ply | undefined) => {
      if (!p) return "<span></span>";
      const classes = [p.side === "jev" ? "by-jev" : "by-maia", p.ply === cursor - 1 ? (live ? "latest" : "current") : ""].join(" ");
      const r = game ? ratings.get(`${game.id}:${p.ply}`) : undefined;
      // Jev's moves carry a bar for the probability it gave the move it played.
      const chosen = isJev(p) ? p.data.top.find((o) => o.san === p.san)?.p : undefined;
      const bar = chosen === undefined ? "" : `<span class="pbar" title="Jev gave it ${pct(chosen)}"><span style="width:${(chosen * 100).toFixed(0)}%"></span></span>`;
      return `<button type="button" class="${classes}" data-ply="${p.ply}" aria-label="Go to ${moveLabel(p)}">${p.san}${nag(r)}${bar}</button>`;
    };
    rows.push(`<li><span class="num">${moveNo(i)}.</span>${cell(plies[i])}${cell(plies[i + 1])}</li>`);
  }
  $("scoresheet").innerHTML = rows.join("");
}

function renderBanner() {
  const { game, plies, cursor, live } = current();
  const banner = $("banner");
  if (!game || game.result === null || cursor !== plies.length) {
    banner.hidden = true;
    return;
  }
  const jevWon = (game.result === "1-0") === (game.jevColor === "w") && game.result !== "1/2-1/2";
  const headline = game.result === "1/2-1/2" ? "Draw" : jevWon ? "Jev wins" : "Maia wins";
  const change = game.ratingAfter !== null ? Math.round(game.ratingAfter - game.ratingBefore) : 0;
  const how = game.termination === "resignation" ? `${jevWon ? "Maia" : "Jev"} resigned` : `By ${game.termination}`;
  banner.innerHTML = `${headline}<small>${how}. Rating ${Math.round(game.ratingBefore)} to ${game.ratingAfter} (${change >= 0 ? "+" : ""}${change}).${live ? " Next game shortly." : ""}</small>`;
  banner.hidden = false;
  if (live && bannerShownFor !== game.id) {
    bannerShownFor = game.id;
    void refreshSummary();
  }
}

function renderReplayBar() {
  const { plies, cursor, live } = current();
  $<HTMLButtonElement>("step-first").disabled = cursor === 0;
  $<HTMLButtonElement>("step-back").disabled = cursor === 0;
  $<HTMLButtonElement>("step-forward").disabled = live || cursor >= plies.length;
  $<HTMLButtonElement>("step-last").disabled = live || cursor >= plies.length;
  $("back-live").hidden = live;
  const where = $("replay-where");
  where.classList.toggle("is-live", live);
  const loading = view.kind === "review" && Boolean(view.loading);
  document.querySelector(".board-wrap")!.classList.toggle("is-loading", loading);
  if (loading) where.textContent = `Loading game ${(view as Extract<View, { kind: "review" }>).game.id}`;
  else if (live) where.textContent = "Live";
  else {
    const g = (view as Extract<View, { kind: "review" }>).game;
    const at = plies[cursor - 1];
    where.textContent = `${g.id === liveGame?.id ? "This game" : `Game ${g.id}`}, ${at ? `after ${moveLabel(at)}` : "start"}`;
  }
}

function showEval(fen: string, e: Evaluation | undefined) {
  if (!e) return;
  const { plies, cursor, game } = current();
  if (fen !== (plies[cursor - 1]?.fen ?? START_FEN)) return;
  const whiteBottom = (game?.jevColor ?? "w") === "w";
  const share = whiteShare(e);
  const bar = $("evalbar");
  bar.classList.toggle("white-on-top", !whiteBottom);
  $("evalbar-white").style.height = `${(share * 100).toFixed(1)}%`;
  const score = $("evalbar-score");
  const whiteAhead = share >= 0.5;
  score.textContent = scoreLabel(e);
  score.className = `evalbar-score ${whiteAhead === whiteBottom ? "at-bottom" : "at-top"} ${whiteAhead ? "on-white" : "on-black"}`;
  bar.setAttribute("aria-label", `Evaluation ${scoreLabel(e)} for ${whiteAhead ? "White" : "Black"}, Stockfish depth ${e.depth}`);
}

function renderEval(fen: string) {
  void engine.analyse(fen, { depth: 14, rank: 0, onInfo: (e) => showEval(fen, e) }).then((a) => showEval(fen, a.lines[0]?.eval));
}

const fenBefore = (plies: Ply[], i: number) => (i === 0 ? START_FEN : plies[i - 1]!.fen);

// Rates every move of a game in the background, oldest first. Results fill in as they arrive.
function queueRatings(game: Game, plies: Ply[]) {
  if (analysingGame !== game.id) {
    engine.clearBackground();
    analysingGame = game.id;
  }
  plies.forEach((ply, i) => {
    const key = `${game.id}:${i}`;
    if (ratings.has(key) || requested.has(key)) return;
    requested.add(key);
    const before = fenBefore(plies, i);
    void Promise.all([engine.analyse(before, { depth: RATE_DEPTH, multipv: 2 }), engine.analyse(ply.fen, { depth: RATE_DEPTH, multipv: 2 })]).then(([b, a]) => {
      const r = a.lines[0] ? rate(before, ply.uci, b, a.lines[0].eval) : null;
      if (!r) {
        requested.delete(key);
        return;
      }
      ratings.set(key, r);
      scheduleNags();
    });
  });
}

// Rates the options shown for a Jev move: one search restricted to exactly those moves.
function queueOptionRatings(game: Game, plies: Ply[], ply: Ply & { data: JevData }) {
  const key = `${game.id}:${ply.ply}`;
  if (optionRatings.has(key)) return;
  const before = fenBefore(plies, ply.ply);
  const ucis = ply.data.top.map((o) => o.uci).filter(Boolean);
  if (!ucis.length) return;
  void Promise.all([
    engine.analyse(before, { depth: RATE_DEPTH, multipv: 2, rank: 1 }),
    engine.analyse(before, { depth: RATE_DEPTH, multipv: ucis.length, searchmoves: ucis, rank: 1 }),
  ]).then(([b, opts]) => {
    if (!b.lines.length || !opts.lines.length) return;
    const map = new Map<string, Rating>();
    for (const line of opts.lines) {
      const r = rate(before, line.uci, b, line.eval);
      if (r) map.set(line.uci, r);
    }
    optionRatings.set(key, map);
    scheduleNags();
  });
}

// Fills in rating symbols wherever they're on screen, without re-running any animation.
function scheduleNags() {
  if (nagsFrame) return;
  nagsFrame = requestAnimationFrame(() => {
    nagsFrame = 0;
    renderScoresheet();
    if (!panelKey) return;
    $("move-nag").innerHTML = nag(ratings.get(panelKey));
    const opts = optionRatings.get(panelKey);
    const played = ratings.get(panelKey);
    document.querySelectorAll<HTMLElement>("#options .option[data-uci]").forEach((li) => {
      // The move actually played uses the same grade as the move list, so the two always agree.
      const r = li.classList.contains("is-chosen") && played ? played : opts?.get(li.dataset.uci!);
      li.querySelector(".nag-slot")!.innerHTML = nag(r);
    });
  });
}

// Redraws everything for the current view. `animate` slides the last move's piece.
function render(animate = false) {
  window.clearTimeout(thinkingTimer);
  const { game, plies, cursor, live } = current();
  const shown = plies[cursor - 1];
  const orientation = game?.jevColor ?? "w";
  drawBoard(board, shown?.fen ?? START_FEN, orientation, lastMoveOf(shown), animate && !reducedMotion);
  // Reviewing a Jev move shows everything it weighed as a heat map; live shows only the move it played.
  drawArrows(board, isJev(shown) ? arrowsFor(shown, true) : [], orientation);
  drawHeat(board, isJev(shown) && !live ? heatFor(shown) : [], orientation);
  const explain = live ? [...plies].reverse().find((p) => isJev(p)) : shown;
  renderMind(explain, false);
  renderPlayers();
  renderScoresheet();
  renderBanner();
  renderReplayBar();
  renderEval(shown?.fen ?? START_FEN);
  if (game) queueRatings(game, plies);
}

// A single new live Jev move: show its options on the board first, then play it.
function revealJevMove(ply: Ply & { data: JevData }) {
  const before = livePlies[ply.ply - 1];
  drawBoard(board, before?.fen ?? START_FEN, liveGame!.jevColor, lastMoveOf(before), false);
  drawArrows(board, [], liveGame!.jevColor);
  drawHeat(board, heatFor(ply), liveGame!.jevColor);
  renderMind(ply, true);
  thinkingTimer = window.setTimeout(() => render(true), THINK_MS);
}

function showNewPlies(fresh: Ply[]) {
  if (fresh.length === 0) return;
  const catchingUp = fresh.length > 1 || livePlies.length === 0;
  livePlies.push(...fresh);
  if (view.kind !== "live") {
    // Keep the review of the live game in step with new moves, without moving its cursor.
    renderScoresheet();
    renderReplayBar();
    return;
  }
  const last = livePlies.at(-1);
  if (!catchingUp && isJev(last) && !reducedMotion) revealJevMove(last);
  else render(!catchingUp);
}

async function poll() {
  try {
    const params = new URLSearchParams();
    if (liveGame) {
      params.set("game", String(liveGame.id));
      params.set("after", String(livePlies.at(-1)?.ply ?? -1));
    }
    if (Date.now() - lastCheckIn > CHECK_IN_MS && !document.hidden) {
      params.set("v", viewerId);
      lastCheckIn = Date.now();
    }
    const live = await getJson<Live>(`/api/live?${params}`);
    maybeNudge(live);
    renderWatching(live.watching);
    if (!live.game) {
      if (view.kind === "live") render();
      return;
    }
    if (!liveGame || live.game.id !== liveGame.id) {
      liveGame = live.game;
      livePlies = [];
      if (view.kind === "live") render();
    }
    liveGame = live.game;
    showNewPlies(live.plies);
    if (view.kind === "live") {
      renderPlayers();
      renderBanner();
    }
  } catch (e) {
    console.warn(e);
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

function renderWatching(n: number) {
  const el = $("watching");
  el.hidden = n < 1;
  el.textContent = `${n} watching now`;
}

// Review mode. The URL hash (#game=12&ply=34) makes a position shareable.
async function openReview(gameId: number, ply: number | null) {
  const place = (data: { game: Game; plies: Ply[] }) => {
    const cursor = ply === null ? data.plies.length : Math.max(0, Math.min(data.plies.length, ply + 1));
    view = { kind: "review", game: data.game, plies: data.plies, cursor };
    render();
    syncHash();
  };
  if (liveGame && gameId === liveGame.id) return place({ game: liveGame, plies: livePlies });

  const pending = fetchGame(gameId);
  // Switch straight away using what the games list already knows, then fill in the moves.
  const known = [...recentGames, ...listedGames].find((g) => g.id === gameId);
  if (known) {
    view = { kind: "review", game: known, plies: [], cursor: 0, loading: true };
    render();
  }
  try {
    const data = await pending;
    // Ignore a slow response if the viewer has already moved on.
    if (view.kind === "review" && view.game.id !== gameId) return;
    if (view.kind === "live" && known) return;
    place(data);
  } catch {
    if (view.kind === "review" && view.game.id === gameId) goLive();
    else history.replaceState(null, "", location.pathname);
  }
}

function boardIntoView() {
  const stage = document.querySelector(".stage")!;
  const top = stage.getBoundingClientRect().top;
  if (top < -40 || top > window.innerHeight * 0.4) stage.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

function goLive() {
  view = { kind: "live" };
  history.replaceState(null, "", location.pathname);
  render();
}

function step(to: number) {
  if (view.kind === "live") {
    if (!liveGame) return;
    view = { kind: "review", game: liveGame, plies: livePlies, cursor: livePlies.length };
  }
  const next = Math.max(0, Math.min(view.plies.length, to));
  const forwardOne = next === view.cursor + 1;
  view.cursor = next;
  render(forwardOne);
  syncHash();
}

function syncHash() {
  if (view.kind !== "review") return;
  const hash = `#game=${view.game.id}&ply=${view.cursor - 1}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function readHash() {
  const m = /game=(\d+)(?:&ply=(-?\d+))?/.exec(location.hash);
  if (!m) return false;
  void openReview(Number(m[1]), m[2] === undefined ? null : Number(m[2]));
  return true;
}

$("step-first").addEventListener("click", () => step(0));
$("step-back").addEventListener("click", () => step(current().cursor - 1));
$("step-forward").addEventListener("click", () => step(current().cursor + 1));
$("step-last").addEventListener("click", () => step(current().plies.length));
$("back-live").addEventListener("click", goLive);
$("scoresheet").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-ply]");
  if (!btn) return;
  const ply = Number(btn.dataset.ply);
  if (view.kind === "live") {
    if (!liveGame) return;
    view = { kind: "review", game: liveGame, plies: livePlies, cursor: ply + 1 };
    render();
    syncHash();
  } else step(ply + 1);
});
// Opening a game from the list: bring the board into view, and start loading on intent.
$("game-list").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("a[href^='#game=']")) boardIntoView();
});
for (const type of ["pointerover", "focusin", "touchstart"] as const) {
  $("game-list").addEventListener(
    type,
    (e) => {
      const id = /game=(\d+)/.exec((e.target as HTMLElement).closest("a")?.getAttribute("href") ?? "")?.[1];
      if (id) void fetchGame(Number(id)).catch(() => {});
    },
    { passive: true },
  );
}

window.addEventListener("hashchange", () => {
  if (!readHash() && view.kind === "review") goLive();
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const { cursor, plies } = current();
  if (e.key === "ArrowLeft") step(cursor - 1);
  else if (e.key === "ArrowRight" && view.kind === "review") step(cursor + 1);
  else if (e.key === "Home") step(0);
  else if (e.key === "End" && view.kind === "review") step(plies.length);
  else if (e.key === "Escape" && view.kind === "review") goLive();
  else return;
  e.preventDefault();
});

function renderSummary(s: Summary) {
  $("rating").textContent = String(s.rating);
  const last = s.recent[0];
  const delta = $("rating-delta");
  if (last && last.ratingAfter !== null) {
    const d = last.ratingAfter - last.ratingBefore;
    delta.textContent = `${d >= 0 ? "+" : ""}${d} last game`;
    delta.className = d >= 0 ? "delta-up" : "delta-down";
  }
  const record = $("record");
  record.className = "record";
  record.innerHTML =
    s.games === 0
      ? "No games finished yet"
      : `<span title="Won">W<b>${s.wins}</b></span><span title="Drawn">D<b>${s.draws}</b></span><span title="Lost">L<b>${s.losses}</b></span>`;
  renderLadder(s);
  renderForm(s.history);
  $("games-count").textContent = s.games ? `${s.games} played` : "";
  // A newly finished game reloads the list, keeping the filter but going back to the first page.
  const newest = s.recent[0]?.id ?? 0;
  if (newest !== listNewest) {
    listNewest = newest;
    pageCache.clear();
    void loadGames();
  }
}

function renderLadder(s: Summary) {
  const svg = $<SVGSVGElement>("ladder");
  svg.style.display = s.history.length === 0 ? "none" : "";
  const note = $("ladder-note");
  note.hidden = s.history.length > 0;
  note.textContent = "Starts after the first game.";
  if (s.history.length === 0) return;
  const points = [{ id: 0, rating: 1000, score: -1 }, ...s.history];
  const W = 600;
  const H = 220;
  const pad = { l: 48, r: 12, t: 12, b: 24 };
  const ratings = points.map((p) => p.rating);
  const lo = Math.floor((Math.min(...ratings) - 50) / 100) * 100;
  const hi = Math.ceil((Math.max(...ratings) + 50) / 100) * 100;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (r: number) => pad.t + (1 - (r - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const grid: string[] = [];
  const stepSize = hi - lo > 600 ? 200 : 100;
  for (let r = lo; r <= hi; r += stepSize) grid.push(`<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(r)}" y2="${y(r)}"/><text class="axis" x="${pad.l - 8}" y="${y(r) + 4}" text-anchor="end">${r}</text>`);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join("");
  const dots = points.length > 80 ? "" : points.slice(1).map((p, i) => `<circle class="${p.score === 1 ? "dot-win" : p.score === 0 ? "dot-loss" : "dot-draw"}" cx="${x(i + 1)}" cy="${y(p.rating)}" r="3.5"/>`).join("");
  const area = `${path}L${x(points.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
  svg.innerHTML = `${grid.join("")}<path class="area" d="${area}"/><path class="line" d="${path}"/>${dots}<text class="axis" x="${pad.l}" y="${H - 4}">Game 1</text><text class="axis" x="${W - pad.r}" y="${H - 4}" text-anchor="end">Game ${Math.max(1, s.games)}</text>`;
}

const scoreOf = (g: Game) => (g.result === "1/2-1/2" ? 0.5 : (g.result === "1-0") === (g.jevColor === "w") ? 1 : 0);

// The last 20 results as squares, oldest first.
function renderForm(history: Summary["history"]) {
  const form = $("form");
  const last = history.slice(-20);
  form.hidden = last.length === 0;
  if (!last.length) return;
  const word = (s: number) => (s === 1 ? "win" : s === 0 ? "loss" : "draw");
  const count = (s: number) => last.filter((h) => h.score === s).length;
  form.innerHTML = `<span class="form-squares" role="img" aria-label="Last ${last.length} results, oldest first: ${count(1)} wins, ${count(0.5)} draws, ${count(0)} losses">${last
    .map((h) => `<span class="form-sq ${word(h.score)}" title="Game ${h.id}: ${word(h.score)}"></span>`)
    .join("")}</span><span class="form-text">last ${last.length}: <b class="delta-up">${count(1)} W</b> · <b>${count(0.5)} D</b> · <b class="delta-down">${count(0)} L</b></span>`;
}

function renderGames() {
  const list = $("game-list");
  $("more-games").hidden = !listHasMore;
  if (listedGames.length === 0) {
    list.innerHTML = `<li class="empty">${listFilter ? "No games match." : "Finished games show up here."}</li>`;
    return;
  }
  list.innerHTML = listedGames
    .map((g) => {
      const score = scoreOf(g);
      const [letter, word, cls] = score === 1 ? ["W", "Won", "win"] : score === 0 ? ["L", "Lost", "loss"] : ["D", "Drew", "draw"];
      const change = (g.ratingAfter ?? g.ratingBefore) - g.ratingBefore;
      const [family, variation] = (g.opening?.name ?? "Unnamed line").split(": ");
      const opening = `<span class="game-family">${family}</span>${variation ? `<span class="game-variation">: ${variation}</span>` : ""}${g.opening ? ` <span class="game-eco">${g.opening.eco}</span>` : ""}`;
      return `<li><a href="#game=${g.id}" aria-label="Game ${g.id}: ${word} as ${colourName(g.jevColor)} against Maia ${g.oppElo} by ${g.termination}, ${g.opening?.name ?? "unnamed opening"}. Replay it.">
        <span class="game-id">${g.id}</span>
        <span class="badge ${cls}" title="${word}">${letter}</span>
        <span class="swatch ${g.jevColor}" title="Jev played ${colourName(g.jevColor)}"></span>
        <span class="game-opening">${opening}</span>
        <span class="game-how">${g.termination} · ${Math.ceil(g.plies / 2)} moves<br><span class="game-opp">vs ${g.oppElo}</span></span>
        <span class="game-change ${change > 0 ? "delta-up" : change < 0 ? "delta-down" : ""}">${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)}</span>
      </a></li>`;
    })
    .join("");
}

type GamePage = { games: Game[]; more: boolean };
// First pages by filter, so switching back to a filter is instant. Cleared when a new game finishes.
const pageCache = new Map<string, Promise<GamePage>>();

function firstPage(filter: string) {
  let page = pageCache.get(filter);
  if (!page) {
    page = getJson<GamePage>(`/api/history?${new URLSearchParams(filter)}`);
    // A failed request isn't kept, so the next attempt tries again.
    page.catch(() => pageCache.delete(filter));
    pageCache.set(filter, page);
  }
  return page;
}

// Loads the first page for the current filter, or the next page after what's shown.
async function loadGames(more = false) {
  const request = ++listRequest;
  const list = $("game-list");
  const button = $<HTMLButtonElement>("more-games");
  button.disabled = true;
  // Fade the old list only if the answer isn't already here, so cached filters don't flicker.
  const slow = window.setTimeout(() => list.classList.add("is-loading"), 80);
  list.setAttribute("aria-busy", "true");
  try {
    let page: GamePage;
    if (more && listedGames.length) {
      const params = new URLSearchParams(listFilter);
      params.set("before", String(listedGames.at(-1)!.id));
      page = await getJson<GamePage>(`/api/history?${params}`);
    } else {
      page = await firstPage(listFilter);
    }
    // A newer request (another filter, or a refresh) wins.
    if (request !== listRequest) return;
    listedGames = more ? [...listedGames, ...page.games] : page.games;
    listHasMore = page.more;
    renderGames();
  } catch (e) {
    console.warn(e);
  } finally {
    if (request === listRequest) {
      window.clearTimeout(slow);
      list.classList.remove("is-loading");
      list.removeAttribute("aria-busy");
      button.disabled = false;
    }
  }
}

$("game-filters").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-filter]");
  if (!button) return;
  listFilter = button.dataset.filter!;
  for (const b of $("game-filters").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
  void loadGames();
});
// Start fetching a filter when the viewer points at it, so most of the wait is over by the click.
for (const type of ["pointerover", "focusin", "touchstart"] as const) {
  $("game-filters").addEventListener(
    type,
    (e) => {
      const filter = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-filter]")?.dataset.filter;
      if (filter !== undefined) void firstPage(filter).catch(() => {});
    },
    { passive: true },
  );
}
$("more-games").addEventListener("click", () => void loadGames(true));

async function refreshSummary() {
  lastSummaryAt = Date.now();
  try {
    const s = await getJson<Summary>("/api/games");
    recentGames = s.recent;
    renderSummary(s);
    // Quietly load the latest few games so the first clicks feel instant.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => s.recent.slice(0, 3).forEach((g) => void fetchGame(g.id).catch(() => {})));
  } catch (e) {
    console.warn(e);
  }
}

setInterval(() => {
  if (Date.now() - lastSummaryAt > 30_000) void refreshSummary();
}, 5_000);

render();
readHash();
void refreshSummary();
void poll();
