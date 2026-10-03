// Where does Jev lose games? Rates every Jev move with Stockfish and sorts its mistakes by cause.
// Usage: npx tsx scripts/diagnose.ts runs/baseline-700/games.json   (or --live for the live site's finished games)
import { Chess, type Move } from "chess.js";
import { readFileSync, writeFileSync } from "node:fs";
import { moveFacts, type MoveFacts, type Tag } from "../src/core/facts";
import { rate, type Grade } from "../web/src/annotate";
import { NodeStockfish } from "./lib/stockfish";

interface Ply {
  ply: number;
  side: "jev" | "opp";
  san: string;
  uci: string;
  fen: string;
  data: { top?: { san: string; uci: string; p: number }[] };
}
interface GameData {
  game: { id: number; jevColor: "w" | "b"; result: string | null; termination: string | null };
  plies: Ply[];
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const DEPTH = 12;
const SITE = "https://jev-plays-chess.view.fast";

async function loadGames(): Promise<GameData[]> {
  const src = process.argv[2];
  if (src && src !== "--live") return JSON.parse(readFileSync(src, "utf8")).games;
  const summary = (await (await fetch(`${SITE}/api/games`)).json()) as { history: { id: number }[] };
  const out: GameData[] = [];
  for (const { id } of summary.history) out.push((await (await fetch(`${SITE}/api/games/${id}`)).json()) as GameData);
  return out;
}

const isBad = (t: Tag) => t.k === "loss" || t.k === "hangs";
const gains = (f: MoveFacts | undefined) => (f?.tags ?? []).reduce((a, t) => a + (t.k === "gain" ? t.n : 0), 0);
const phaseOf = (ply: number, fen: string) => {
  const heavy = fen.split(" ")[0]!.replace(/[^qrbnQRBN]/g, "").length;
  return heavy <= 6 ? "endgame" : ply < 20 ? "opening" : "middlegame";
};

// Why a costly move was costly, from the facts Jev had and the opponent's best reply.
function cause(before: Chess, chosen: MoveFacts, all: MoveFacts[], bestUci: string, replyUci: string): string {
  if (all.some((f) => f.tags.some((t) => t.k === "mate")) && !chosen.tags.some((t) => t.k === "mate")) return "missed a mate in one";
  if (chosen.tags.some(isBad)) return "ignored a warning in its facts (piece left hanging or losing trade)";
  const best = all.find((f) => f.uci === bestUci);
  if (gains(best) >= 3 && gains(chosen) < gains(best)) return "passed up free material";
  if (!replyUci) return "other";
  before.move(chosen.san);
  const reply = moveFacts(before).find((f) => f.uci === replyUci);
  before.undo();
  if (!reply) return "other";
  if (reply.tags.some((t) => t.k === "mate")) return "allowed a mate in one";
  if (reply.tags.some((t) => t.k === "fork")) return "allowed a fork";
  if (reply.tags.some((t) => t.k === "gain" && t.n >= 2)) return "allowed a capture its facts didn't flag (pin, discovery or overload)";
  if (reply.tags.some((t) => t.k === "check")) return "allowed a checking attack";
  return "deeper tactic or positional";
}

const games = await loadGames();
const sf = await NodeStockfish.create();
const grades: Record<string, Record<Grade, number>> = { jev: {} as Record<Grade, number>, opp: {} as Record<Grade, number> };
const causes: Record<string, number> = {};
const byPhase: Record<string, { moves: number; costly: number }> = {};
let jevMoves = 0;
let bestInOptions = 0;
let probOnBest = 0;
const examples: { game: number; move: string; cause: string; fen: string; played: string; best: string }[] = [];

let done = 0;
for (const { game, plies } of games) {
  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    const fen = i === 0 ? START : plies[i - 1]!.fen;
    const [b, a] = [await sf.analyse(fen, DEPTH, 2), await sf.analyse(ply.fen, DEPTH, 1)];
    const r = a.lines[0] ? rate(fen, ply.uci, b, a.lines[0].eval) : null;
    if (!r) continue;
    grades[ply.side]![r.grade] = (grades[ply.side]![r.grade] ?? 0) + 1;
    if (ply.side !== "jev") continue;

    jevMoves++;
    const phase = phaseOf(i, fen);
    byPhase[phase] ??= { moves: 0, costly: 0 };
    byPhase[phase].moves++;
    const bestUci = b.lines[0]?.uci ?? "";
    const top = ply.data.top ?? [];
    if (top.some((o) => o.uci === bestUci)) bestInOptions++;
    probOnBest += top.find((o) => o.uci === bestUci)?.p ?? 0;

    if (r.grade === "mistake" || r.grade === "blunder") {
      byPhase[phase].costly++;
      const chess = new Chess(fen);
      const all = moveFacts(chess);
      const chosen = all.find((f) => f.uci === ply.uci)!;
      const c = cause(chess, chosen, all, bestUci, a.lines[0]?.uci ?? "");
      causes[c] = (causes[c] ?? 0) + 1;
      const bestSan = (() => {
        try {
          return (new Chess(fen).move(bestUci) as Move).san;
        } catch {
          return bestUci;
        }
      })();
      examples.push({ game: game.id, move: `${Math.floor(i / 2) + 1}${i % 2 ? "..." : "."} ${ply.san}`, cause: c, fen, played: ply.san, best: bestSan });
    }
  }
  process.stdout.write(`\r${++done}/${games.length} games analysed`);
}
process.stdout.write("\n");

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const costly = (g: Record<Grade, number>) => (g.mistake ?? 0) + (g.blunder ?? 0);
const total = (g: Record<Grade, number>) => Object.values(g).reduce((x, y) => x + y, 0);
console.log(`\n${games.length} games, ${jevMoves} Jev moves`);
console.log(`Jev: blunders ${pct(grades.jev!.blunder ?? 0, total(grades.jev!))}, mistakes ${pct(grades.jev!.mistake ?? 0, total(grades.jev!))}, inaccuracies ${pct(grades.jev!.inaccuracy ?? 0, total(grades.jev!))}`);
console.log(`Maia: blunders ${pct(grades.opp!.blunder ?? 0, total(grades.opp!))}, mistakes ${pct(grades.opp!.mistake ?? 0, total(grades.opp!))}, inaccuracies ${pct(grades.opp!.inaccuracy ?? 0, total(grades.opp!))}`);
console.log(`Stockfish's best move was among Jev's top options ${pct(bestInOptions, jevMoves)} of the time; average weight Jev gave it: ${pct(probOnBest, jevMoves)}`);
console.log("\nCostly moves (mistakes and blunders) by phase:");
for (const [phase, v] of Object.entries(byPhase)) console.log(`  ${phase.padEnd(11)} ${pct(v.costly, v.moves)} of ${v.moves} moves`);
console.log("\nWhy Jev's mistakes and blunders were costly:");
const nCostly = costly(grades.jev!);
for (const [c, n] of Object.entries(causes).sort((x, y) => y[1] - x[1])) console.log(`  ${pct(n, nCostly).padStart(6)}  ${c} (${n})`);
const outFile = process.argv[2] && process.argv[2] !== "--live" ? process.argv[2].replace(/games\.json$/, "diagnosis.json") : "runs/live-diagnosis.json";
writeFileSync(outFile, JSON.stringify({ grades, causes, byPhase, examples }, null, 1));
console.log(`\nExamples saved to ${outFile}`);
process.exit(0);
