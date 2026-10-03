// Copies the Stockfish browser build and downloads the Maia weights into web/public so Vite serves and ships them.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { WEIGHTS } from "maia3-ts";

mkdirSync("web/public/stockfish", { recursive: true });
for (const ext of ["js", "wasm"]) {
  copyFileSync(`node_modules/stockfish/bin/stockfish-19-lite-single.${ext}`, `web/public/stockfish/stockfish-19-lite-single.${ext}`);
}

const weights = "web/public/maia3-5m.safetensors";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
if (!existsSync(weights) || sha256(readFileSync(weights)) !== WEIGHTS.sha256) {
  const res = await fetch(WEIGHTS.url);
  if (!res.ok) throw new Error(`Fetching Maia weights failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== WEIGHTS.sha256) throw new Error("Maia weights don't match the expected SHA-256");
  writeFileSync(weights, buf);
}
