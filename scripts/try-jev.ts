// Asks Jev for one move in a given position and prints its top choices. Usage: npx tsx scripts/try-jev.ts "<fen>"
import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import { askJev, buildJevRequest, JEV_INPUT_PRICE } from "../src/core/jev";

const key = process.env.TYPESAFE_API_KEY ?? /TYPESAFE_API_KEY=(.+)/.exec(readFileSync(".env.server", "utf8"))?.[1];
if (!key) throw new Error("Set TYPESAFE_API_KEY or create .env.server");
const chess = new Chess(process.argv[2] ?? undefined);
const { request, facts } = buildJevRequest(chess, []);
if (process.argv.includes("--show")) console.log(JSON.stringify(request, null, 1));
const d = await askJev(key, request, facts);
console.log(`resign ${d.resign.toFixed(2)}  ${d.san}  confidence ${d.confidence}  ${d.latencyMs}ms  ${d.inputTokens} tokens ($${(d.inputTokens * JEV_INPUT_PRICE).toFixed(6)})`);
for (const o of d.options.slice(0, 6)) console.log(`  ${o.san.padEnd(8)} ${(o.p * 100).toFixed(1)}%`);
