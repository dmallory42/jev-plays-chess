# Jev plays chess

Jev, TypeSafe AI's decision model, plays chess nonstop against [Maia-3](https://github.com/CSSLab/maia3) opponents set to its current rating, and climbs (or falls down) an Elo ladder. Anyone can watch.

## How it works

- Each turn, `src/core/facts.ts` lists every legal move with facts about it: captures, checks, material won or lost on that square, pieces left open to capture, threats. Nothing looks ahead to the opponent's reply.
- `src/core/jev.ts` sends the position and the moves to Jev as one Choice question. Jev picks a move and returns a probability for every option.
- The opponent is Maia-3 (5M), run in plain TypeScript by [maia3-ts](https://github.com/dmallory42/maia3-ts) so it fits in a Spacefast worker.
- `src/core/runner.ts` plays the games, paces the moves for viewers (one every 3 seconds, at most 60 seconds ahead) and updates the rating after each game.
- The viewer's evaluation bar runs Stockfish (lite, single-threaded WASM) in the browser. It's display only and never reaches Jev.
- The site is static (`web/`) plus Spacefast Functions routes (`functions/api/`) backed by the space's database.

## Develop

```bash
npm install
node scripts/copy-assets.mjs                # Stockfish and the Maia weights into web/public
npm test
npx tsx scripts/dev-server.ts --fake-jev   # local API on :8788; drop --fake-jev to use real Jev
npx vite web                               # viewer on :5173, proxies /api
```

Real Jev calls need `TYPESAFE_API_KEY` in the environment or in `.env.server` (gitignored).

## Deploy

```bash
npx spacefast env set TYPESAFE_API_KEY --value-from-stdin < key.txt   # once
npm run deploy
```

## Licence

GPL-2.0-or-later. The site runs with [maia3-ts](https://github.com/dmallory42/maia3-ts), a port of Maia-3 by the CSSLab at the University of Toronto, which is AGPL-3.0-or-later, so the deployed site as a whole is offered under AGPL-3.0 terms. Chess pieces by Colin M.L. Burnett (GPLv2+). Stockfish is GPLv3.
