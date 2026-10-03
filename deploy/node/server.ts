// Runs the whole site in one Node process: static files, the API, SQLite storage and a tick timer,
// so games keep moving with nobody watching.
// Usage: npm run build && npm run build:node && npm start
// Settings: PORT (default 8080), DB_PATH (default data/jev.sqlite), STATIC_DIR (default web/dist), TYPESAFE_API_KEY.
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { D1Like } from "../../src/core/sql-store";
import { handleApi, type AppConfig } from "../../src/server/app";

const TICK_EVERY_MS = 5_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

// Wraps node:sqlite in the D1-style interface the store expects.
export function sqliteD1(path: string): D1Like {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const statement = (sql: string, args: unknown[]) => {
    const params = args.map((a) => (a === undefined ? null : a)) as (string | number | null)[];
    return {
      all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...params) as T | undefined) ?? null,
      run: async () => db.prepare(sql).run(...params),
    };
  };
  return { prepare: (sql) => Object.assign(statement(sql, []), { bind: (...args: unknown[]) => statement(sql, args) }) };
}

function serveStatic(root: string, pathname: string, res: import("node:http").ServerResponse) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

export function startServer(opts: { port: number; staticDir: string; config: AppConfig; tick?: boolean }) {
  const root = resolve(opts.staticDir);
  const origin = `http://127.0.0.1:${opts.port}`;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", origin);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
      const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body, duplex: "half" } as RequestInit);
      const response = await handleApi(request, opts.config);
      if (!response) return serveStatic(root, url.pathname, res);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Server error");
    }
  });
  server.listen(opts.port, () => console.log(`Jev plays chess on ${origin}`));
  if (opts.tick !== false) {
    // The lease in the store means overlapping ticks are harmless.
    const run = () => handleApi(new Request(`${origin}/api/tick`, { method: "POST" }), opts.config).catch((e) => console.error(e));
    setInterval(run, TICK_EVERY_MS);
    server.once("listening", () => void run());
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const typesafeApiKey = process.env.TYPESAFE_API_KEY;
  if (!typesafeApiKey) console.warn("TYPESAFE_API_KEY is not set, so games won't advance. Past games are still viewable.");
  startServer({
    port: Number(process.env.PORT ?? 8080),
    staticDir: process.env.STATIC_DIR ?? "web/dist",
    config: { db: sqliteD1(process.env.DB_PATH ?? "data/jev.sqlite"), dialect: "sqlite", typesafeApiKey },
    tick: Boolean(typesafeApiKey),
  });
}
