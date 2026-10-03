// Chess notation with piece icons, and the small tags that describe a move.
import { pieceSrc } from "./board";

export type Colour = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type Tag =
  | { k: "mate" | "check" | "draw" | "fork" | "castle" | "develop" | "defends" | "early-queen" | "king-walk" }
  | { k: "capture"; piece: PieceType; square: string }
  | { k: "gain" | "loss"; n: number; square: string }
  | { k: "trade"; square: string }
  | { k: "hangs"; piece: PieceType; square: string; n: number }
  | { k: "attacks"; piece: PieceType; square: string }
  | { k: "saves"; piece: PieceType }
  | { k: "promote"; piece: PieceType };

const NAME: Record<PieceType, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const other = (c: Colour): Colour => (c === "w" ? "b" : "w");

export const pieceIcon = (colour: Colour, type: PieceType, cls = "pc") => `<img class="${cls}" src="${pieceSrc(colour, type)}" alt="${colour === "w" ? "white" : "black"} ${NAME[type]}">`;

// Figurine notation: the piece letter becomes an icon in the mover's colour.
export function figurine(san: string, mover: Colour) {
  const m = /^([KQRBN])(.*)$/.exec(san);
  const body = m ? m[2]! : san;
  const promo = /=([QRBN])/.exec(body);
  const text = promo ? body.replace(promo[0], "=") : body;
  const head = m ? pieceIcon(mover, m[1]!.toLowerCase() as PieceType) : "";
  const tail = promo ? pieceIcon(mover, promo[1]!.toLowerCase() as PieceType) : "";
  return `<span class="fig">${head}${text.replace(/[+#]$/, "")}${tail}${/[+#]$/.test(text) ? text.at(-1) : ""}</span>`;
}

const ICON = {
  target: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
  shield: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13.5 3.5v4c0 3.4-2.4 5.8-5.5 7-3.1-1.2-5.5-3.6-5.5-7v-4z" fill="currentColor"/></svg>`,
  fork: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14V8M8 8 3.5 3M8 8l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="3.5" cy="3" r="1.6" fill="currentColor"/><circle cx="12.5" cy="3" r="1.6" fill="currentColor"/></svg>`,
  up: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  list: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="2.5" cy="4" r="1" fill="currentColor"/><circle cx="2.5" cy="8" r="1" fill="currentColor"/><circle cx="2.5" cy="12" r="1" fill="currentColor"/></svg>`,
  memory: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2.5 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5.5V8l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  book: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5c1.8-.8 3.7-.8 5.5.4v9c-1.8-1.2-3.7-1.2-5.5-.4zM13.5 3.5c-1.8-.8-3.7-.8-5.5.4v9c1.8-1.2 3.7-1.2 5.5-.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  flag: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14.5V2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 2.5h8.5l-2 3 2 3H4z" fill="currentColor"/></svg>`,
  warn: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="currentColor"/><path d="M8 6v4" stroke="var(--panel)" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r=".9" fill="var(--panel)"/></svg>`,
};
export const icon = (name: keyof typeof ICON) => ICON[name];

const chip = (cls: string, title: string, body: string) => `<li class="chip ${cls}" title="${title}"><span class="sr">${title}</span><span aria-hidden="true" class="chip-body">${body}</span></li>`;

// One tag as a chip. The mover is the side that played the move; the hover title carries the words.
export function tagChip(t: Tag, mover: Colour): string {
  const them = other(mover);
  switch (t.k) {
    case "gain":
      return chip("good", `Wins ${t.n} in material on ${t.square}`, `+${t.n}`);
    case "loss":
      return chip("bad", `Loses ${t.n} in material on ${t.square}`, `−${t.n}`);
    case "trade":
      return chip("quiet", `Even trade on ${t.square}`, "=");
    case "hangs":
      return chip("bad", `Leaves the ${NAME[t.piece]} on ${t.square} open to capture (−${t.n})`, `${pieceIcon(mover, t.piece)}${t.square}<b>−${t.n}</b>`);
    case "attacks":
      return chip("threat", `Attacks the ${NAME[t.piece]} on ${t.square}`, `${icon("target")}${pieceIcon(them, t.piece)}${t.square}`);
    case "saves":
      return chip("good", `Moves the threatened ${NAME[t.piece]} to safety`, `${icon("shield")}${pieceIcon(mover, t.piece)}`);
    case "defends":
      return chip("good", "Defends a threatened piece", icon("shield"));
    case "fork":
      return chip("threat", "Fork: attacks two things at once", icon("fork"));
    case "develop":
      return chip("quiet", "Develops a piece", icon("up"));
    case "castle":
      return chip("quiet", "Castles, tucking the king away", `${pieceIcon(mover, "k")}${pieceIcon(mover, "r")}`);
    case "early-queen":
      return chip("quiet", "Early queen move", `${pieceIcon(mover, "q")}!?`);
    case "king-walk":
      return chip("quiet", "Moves the king and gives up castling", `${pieceIcon(mover, "k")}!?`);
    case "draw":
      return chip("quiet", "Ends the game in a draw", "½");
    case "mate":
      return chip("good strong", "Checkmate", "#");
    case "check":
    case "capture":
    case "promote":
      // Already shown by the notation itself.
      return "";
  }
}

export const tagChips = (tags: Tag[] | undefined, mover: Colour) => (tags ?? []).map((t) => tagChip(t, mover)).join("");
