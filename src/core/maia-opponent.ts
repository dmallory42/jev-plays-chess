import { Chess } from "chess.js";
import { loadMaia, maiaPolicy, type MaiaModel } from "maia3-ts";
import type { OpponentMove } from "./runner";

export const MAIA_WEIGHTS_PATH = "/maia3-5m.safetensors";

let model: MaiaModel | null = null;

// Loads the weights once per isolate from the site's own static files.
async function getModel(origin: string) {
  if (!model) {
    const res = await fetch(new URL(MAIA_WEIGHTS_PATH, origin));
    if (!res.ok) throw new Error(`Maia weights ${res.status}`);
    model = loadMaia(await res.arrayBuffer());
  }
  return model;
}

export function maiaOpponent(origin: string) {
  return async (input: { fen: string; historyUci: string[]; elo: number; jevElo: number }): Promise<OpponentMove> => maiaOpponentFrom(await getModel(origin))(input);
}

// The same opponent from a model already in memory, for local scripts.
export function maiaOpponentFrom(m: MaiaModel) {
  return async (input: { fen: string; historyUci: string[]; elo: number; jevElo: number }): Promise<OpponentMove> => {
    // One forward pass gives both the move probabilities and Maia's win/draw/loss estimate.
    // Sampling in proportion matches maiaMove's defaults (temperature 1, no top-p cut).
    const { policy, value } = maiaPolicy(m, { fen: input.fen, history: input.historyUci, eloSelf: input.elo, eloOppo: input.jevElo });
    const entries = Object.entries(policy);
    let r = Math.random();
    let move = entries.at(-1)![0];
    for (const [uci, p] of entries) {
      r -= p;
      if (r < 0) {
        move = uci;
        break;
      }
    }
    const chess = new Chess(input.fen);
    const top = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([uci, p]) => {
        const san = chess.move(uci).san;
        chess.undo();
        return { uci, san, p };
      });
    return { uci: move, top, value };
  };
}
