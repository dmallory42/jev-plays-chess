# Jev plays chess

Jev, TypeSafe AI's decision model, plays chess nonstop against [Maia-3](https://github.com/CSSLab/maia3) opponents set to its current rating, and climbs (or falls down) an Elo ladder. Anyone can watch.

## How it works

- Each turn, `src/core/facts.ts` lists every legal move with facts about it: captures, checks, material won or lost on that square, pieces left open to capture, threats. Nothing looks ahead to the opponent's reply.
- `src/core/jev.ts` sends the position and the moves to Jev as one Choice question. Jev picks a move and returns a probability for every option.
- The opponent is Maia-3 (5M), run in plain TypeScript by [maia3-ts](https://github.com/dmallory42/maia3-ts), so it fits in small serverless workers.
- `src/core/runner.ts` plays the games, paces the moves for viewers (one every 3 seconds, at most 60 seconds ahead) and updates the rating after each game.
- The viewer's evaluation bar runs Stockfish (lite, single-threaded WASM) in the browser. It's display only and never reaches Jev.

## Running it

The site is a static viewer (`web/`) plus an API that `src/server/app.ts` provides as one Web-standard fetch handler. A host needs to provide:

- static file hosting for the built viewer and the Maia weights
- something that runs the fetch handler for `/api/*`
- a MySQL or SQLite database, reached through a D1-style binding
- the `TYPESAFE_API_KEY` secret
- optionally, a timer that calls `/api/tick`. Without one, games only advance while someone has the page open.

`deploy/` has an adapter for each host. The simplest is `deploy/node`, which runs everything in one Node process with SQLite and a built-in timer:

```bash
npm install
npm run build
npm run build:node
TYPESAFE_API_KEY=... npm start   # http://localhost:8080, data in data/jev.sqlite
```

Or as a container:

```bash
docker build -f deploy/node/Dockerfile -t jev-plays-chess .
docker run -p 8080:8080 -v jev-data:/data -e TYPESAFE_API_KEY=... jev-plays-chess
```

## Develop

Needs Node 22.13 or later, for its built-in SQLite.

```bash
npm install
npm test
npm run dev:api -- --fake-jev   # API on :8788 with an in-memory database; drop --fake-jev to use real Jev
npm run dev                     # viewer on :5173, proxies /api
```

`--fake-jev` swaps Jev for a stand-in that grabs material, so development doesn't spend TypeSafe credits. `--random-opponent` does the same for Maia. Real Jev calls need `TYPESAFE_API_KEY` in the environment or in `.env.server` (gitignored).

## Licence

GPL-2.0-or-later. The site runs with [maia3-ts](https://github.com/dmallory42/maia3-ts), a port of Maia-3 by the CSSLab at the University of Toronto, which is AGPL-3.0-or-later, so the deployed site as a whole is offered under AGPL-3.0 terms. Chess pieces by Colin M.L. Burnett (GPLv2+). Stockfish is GPLv3. Opening names come from [Lichess's chess-openings list](https://github.com/lichess-org/chess-openings) (CC0).
