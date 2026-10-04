// Builds src/core/openings-data.json from Lichess's chess-openings list (CC0): every named position, keyed by
// board, side to move, castling and en passant, so transpositions reach the same name.
// Usage: npx tsx scripts/build-openings.ts
import { Chess } from "chess.js";
import { writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const out: Record<string, string> = {};
for (const file of ["a", "b", "c", "d", "e"]) {
  const tsv = await (await fetch(`${BASE}/${file}.tsv`)).text();
  for (const row of tsv.trim().split("\n").slice(1)) {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    for (const token of pgn!.split(" ")) if (!/^\d+\.$/.test(token)) chess.move(token);
    // The list's own order puts the general name before its variations, so a later duplicate is skipped.
    out[positionKey(chess.fen())] ??= `${eco}|${name}`;
  }
}
writeFileSync("src/core/openings-data.json", JSON.stringify(out));
console.log(`${Object.keys(out).length} positions`);

function positionKey(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}
