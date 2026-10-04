import "./theme";
import { CHANGES } from "./changes";

interface Summary {
  history: { id: number; rating: number; score: number }[];
}

const START_RATING = 1000;
const $ = (id: string) => document.getElementById(id)!;

const record = (games: Summary["history"]) => {
  const n = (s: number) => games.filter((g) => g.score === s).length;
  return `${n(1)} W · ${n(0.5)} D · ${n(0)} L`;
};
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

// Each change with where Jev stood when it went live, and how Jev has done with it until the next change.
function render(history: Summary["history"]) {
  const changes = [...CHANGES].sort((a, b) => b.fromGame - a.fromGame);
  $("changes").innerHTML = changes
    .map((c, i) => {
      const until = i === 0 ? Infinity : changes[i - 1]!.fromGame;
      const before = history.filter((g) => g.id < c.fromGame);
      const during = history.filter((g) => g.id >= c.fromGame && g.id < until);
      const ratingThen = before.at(-1)?.rating ?? START_RATING;
      const change = (during.at(-1)?.rating ?? ratingThen) - ratingThen;
      const stat = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
      const stats = [
        stat("Rating then", String(ratingThen)),
        stat("Record then", before.length ? `${record(before)}` : "No games yet"),
        stat(
          i === 0 ? "Since" : "With this version",
          during.length ? `${during.length} ${during.length === 1 ? "game" : "games"} · ${record(during)} · <span class="${change > 0 ? "delta-up" : change < 0 ? "delta-down" : ""}">${signed(change)}</span>` : "No games yet",
        ),
      ];
      return `<li class="change">
        <p class="change-when">${c.date} · from game ${c.fromGame}</p>
        <h2 class="change-title">${c.title}</h2>
        <p class="change-body">${c.body}</p>
        <dl class="change-stats">${stats.join("")}</dl>
      </li>`;
    })
    .join("");
}

fetch("/api/games")
  .then((r) => r.json() as Promise<Summary>)
  .then((s) => render(s.history))
  .catch(() => ($("changes").innerHTML = `<li class="empty">Couldn't load the log. Refresh to try again.</li>`));
