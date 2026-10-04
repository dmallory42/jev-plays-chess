import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), how: resolve(__dirname, "how.html"), lessons: resolve(__dirname, "lessons.html"), log: resolve(__dirname, "log.html") } },
  },
  // Local dev: the API is served by scripts/dev-server.ts, or set API=https://jev-plays-chess.view.fast to read the live site.
  server: { proxy: { "/api": { target: process.env.API ?? "http://127.0.0.1:8788", changeOrigin: true } } },
});
