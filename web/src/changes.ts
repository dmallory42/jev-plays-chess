// Changes to how Jev chooses its moves, newest first. `fromGame` is the first game played with them.
// Only changes to what Jev is shown or asked belong here, not changes to the site.
export interface Change {
  fromGame: number;
  date: string;
  items: { kind: "Added" | "Changed"; text: string }[];
  /** For the testing period, whose games were cleared at the restart: the snapshot as it stood, from the archive. */
  frozen?: { then: string; during: string; change: number };
}

/** The testing period before the restart, summed up from the archive of its 235 games. */
export const TESTING = { dates: "29 September to 4 October 2026", summary: "235 games · 82 W · 76 D · 77 L · peak 1000, low 657, finished at 885" };

export const CHANGES: Change[] = [
  {
    fromGame: 1,
    date: "4 October 2026",
    items: [
      {
        kind: "Changed",
        text: "A fresh start: every game and everything Jev had learned was cleared, and Jev starts again at 600, the lowest rating Maia plays at. Every change below still applies; its memory simply starts empty and builds up from the new games.",
      },
    ],
  },
  {
    fromGame: 235,
    date: "4 October 2026",
    items: [{ kind: "Changed", text: "Exploring moves favour the options Jev itself rated next best, instead of any move that doesn't lose material." }],
    frozen: { then: "Rating 885 · 82 W · 75 D · 77 L", during: "1 game · 0 W · 1 D · 0 L", change: 0 },
  },
  {
    fromGame: 232,
    date: "4 October 2026",
    items: [
      {
        kind: "Added",
        text: "In its first four moves, about one in seven of Jev's moves tries another option instead of its top pick, so its opening records compare more than one line. These are marked \"Exploring\". Until now it had played 1. Nf3 in every game as White since memory went in.",
      },
    ],
    frozen: { then: "Rating 905 · 82 W · 74 D · 75 L", during: "3 games · 0 W · 1 D · 2 L", change: -20 },
  },
  {
    fromGame: 61,
    date: "1 October 2026",
    items: [
      { kind: "Added", text: "Memory of past games: options of a kind that has often gone wrong carry a warning, such as \"moves like this went wrong in 6 of your last 11 tries\"." },
      { kind: "Added", text: "Opening records: in the opening, Jev sees how it has scored after each move. In a 300-game test against Maia at 1000, Jev scored 51% with memory and 45% without." },
    ],
    frozen: { then: "Rating 695 · 14 W · 18 D · 28 L", during: "171 games · 68 W · 56 D · 47 L", change: 210 },
  },
  {
    fromGame: 60,
    date: "30 September 2026",
    items: [
      { kind: "Changed", text: "Each option leads with its overall material result once the exchanges are over, and the options are grouped: checkmate, wins material, safe, loses material. The facts are the same; only the layout changed. In a 300-game test against Maia at 700, this took Jev's score from 58% to 85%." },
    ],
    frozen: { then: "Rating 685 · 13 W · 18 D · 28 L", during: "1 game · 1 W · 0 D · 0 L", change: 10 },
  },
  {
    fromGame: 56,
    date: "30 September 2026",
    items: [{ kind: "Added", text: "Alongside each move, Jev is asked whether its position is so clearly lost that a sensible player would give up. It resigns when it says yes firmly on two turns in a row." }],
    frozen: { then: "Rating 696 · 13 W · 15 D · 27 L", during: "4 games · 0 W · 3 D · 1 L", change: -11 },
  },
  {
    fromGame: 1,
    date: "29 September 2026",
    items: [
      { kind: "Added", text: "Jev is shown every legal move with plain facts about it: what it captures, whether it gives check, material won or lost on that square, pieces it leaves open to capture and the threats it makes." },
      { kind: "Added", text: "It starts at a rating of 1000, playing Maia set to its own rating." },
    ],
    frozen: { then: "Rating 1000", during: "55 games · 13 W · 15 D · 27 L", change: -304 },
  },
];
