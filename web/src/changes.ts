// Changes to how Jev chooses its moves, newest first. `fromGame` is the first game played with the change.
// Only changes to what Jev is shown or asked belong here, not changes to the site.
export interface Change {
  fromGame: number;
  date: string;
  title: string;
  body: string;
}

export const CHANGES: Change[] = [
  {
    fromGame: 232,
    date: "4 October 2026",
    title: "Jev tries other openings",
    body: "With memory, Jev played 1. Nf3 in every game as White: it was the first move that scored well, so Jev never tried another. Now, in its first four moves, about one in seven plays one of its other options that doesn't lose material instead of its top pick, so its opening records compare more than one line. These moves are marked \"Exploring\".",
  },
  {
    fromGame: 61,
    date: "1 October 2026",
    title: "Jev remembers its past games",
    body: "Before each move, options of a kind that has often gone wrong for Jev now carry a warning, such as \"moves like this went wrong in 6 of your last 11 tries\". In the opening, Jev also sees how it has scored after each move. In a 300-game test against Maia at 1000, Jev scored 51% with memory and 45% without.",
  },
  {
    fromGame: 60,
    date: "30 September 2026",
    title: "Options sorted by what they win or lose",
    body: "Each move now leads with its overall material result once the exchanges are over, and the moves are grouped: checkmate, wins material, safe, loses material. The facts are the same; only the layout changed. In a 300-game test against Maia at 700, it took Jev's score from 58% to 85%.",
  },
  {
    fromGame: 56,
    date: "30 September 2026",
    title: "Jev can resign",
    body: "Alongside each move, Jev is also asked whether its position is so clearly lost that a sensible player would give up. It resigns when it says yes firmly on two turns in a row.",
  },
  {
    fromGame: 1,
    date: "29 September 2026",
    title: "First games",
    body: "Jev is shown every legal move with plain facts about it: what it captures, whether it gives check, material won or lost on that square, pieces it leaves open to capture and the threats it makes. It starts at 1000, playing Maia set to its own rating.",
  },
];
