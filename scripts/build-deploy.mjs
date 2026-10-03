// Assembles .deploy/ for Spacefast: the built site plus one bundled module per API route.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const out = ".deploy";
mkdirSync(out, { recursive: true });
// Keep the CLI's space selection between builds.
for (const entry of readdirSync(out)) if (entry !== ".spacefast") rmSync(join(out, entry), { recursive: true, force: true });

cpSync("web/dist", out, { recursive: true });

const routes = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".ts") && !name.startsWith("_")) routes.push(path);
  }
};
walk("functions");

for (const entry of routes) {
  await build({
    entryPoints: [entry],
    outfile: join(out, relative(".", entry)).replace(/\.ts$/, ".js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    minify: true,
    logLevel: "warning",
  });
}

writeFileSync(
  join(out, "sf.jsonc"),
  JSON.stringify(
    {
      $schema: "https://spacefast.com/schemas/sf.json",
      runtime: { kind: "functions", database: true },
      crons: [{ path: "/api/tick", schedule: "* * * * *" }],
      // Browsers only compile streamed WebAssembly served with this type.
      headers: [{ source: "/stockfish/stockfish-19-lite-single.wasm", headers: [{ key: "Content-Type", value: "application/wasm" }] }],
    },
    null,
    2,
  ),
);

if (!existsSync(join(out, "maia3-5m.safetensors"))) console.warn("Warning: maia3-5m.safetensors is missing from the build");
console.log(`Built ${routes.length} routes into ${out}/`);
