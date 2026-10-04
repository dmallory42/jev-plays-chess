export const START_RATING = 600;
// Maia-3's trustworthy Elo range; opponents are clamped to it.
export const OPPONENT_MIN_ELO = 600;
export const OPPONENT_MAX_ELO = 2600;
const PROVISIONAL_GAMES = 30;

export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));

// Bigger steps while provisional so the rating finds its level quickly.
export const kFactor = (gamesPlayed: number) => (gamesPlayed < PROVISIONAL_GAMES ? 40 : 20);

export function updateRating(rating: number, opponent: number, score: 0 | 0.5 | 1, gamesPlayed: number) {
  return rating + kFactor(gamesPlayed) * (score - expectedScore(rating, opponent));
}

// The next opponent sits at Jev's current rating, rounded to 25 so the pairings read cleanly.
export function pickOpponentElo(rating: number) {
  return Math.min(OPPONENT_MAX_ELO, Math.max(OPPONENT_MIN_ELO, Math.round(rating / 25) * 25));
}
