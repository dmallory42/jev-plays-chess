import { Chess } from "chess.js";
import data from "./openings-data.json";

// Named positions from Lichess's chess-openings list (CC0), built by scripts/build-openings.ts.
const NAMED = data as Record<string, string>;

/** How many plies are checked for a name. The longest line in the list is 36 plies. */
export const OPENING_NAME_PLIES = 40;

export interface Opening {
  eco: string;
  /** Full name, e.g. "Sicilian Defense: Najdorf Variation". */
  name: string;
  /** The part before the colon, e.g. "Sicilian Defense". */
  family: string;
}

const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** The opening a game reached: the last named position in its first moves, or null if it never reached one. */
export function classifyOpening(sans: string[]): Opening | null {
  const chess = new Chess();
  let found: string | undefined;
  for (const san of sans.slice(0, OPENING_NAME_PLIES)) {
    try {
      chess.move(san);
    } catch {
      break;
    }
    found = NAMED[positionKey(chess.fen())] ?? found;
  }
  if (!found) return null;
  const [eco, name] = found.split("|") as [string, string];
  return { eco, name, family: name.split(":")[0]! };
}
