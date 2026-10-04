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

// Each release as a timeline entry: what changed, where Jev stood when it went live, and how it did until the next.
function render(history: Summary["history"]) {
  const changes = [...CHANGES].sort((a, b) => b.fromGame - a.fromGame);
  $("changes").innerHTML = changes
    .map((c, i) => {
      const until = i === 0 ? Infinity : changes[i - 1]!.fromGame;
      const before = history.filter((g) => g.id < c.fromGame);
      const during = history.filter((g) => g.id >= c.fromGame && g.id < until);
      const ratingThen = before.at(-1)?.rating ?? START_RATING;
      const change = (during.at(-1)?.rating ?? ratingThen) - ratingThen;
      const then = `Rating ${ratingThen}${before.length ? ` · ${record(before)}` : ""}`;
      const since = during.length
        ? `${i === 0 ? "Since" : "Then"}: ${during.length} ${during.length === 1 ? "game" : "games"} · ${record(during)} · <span class="${change > 0 ? "delta-up" : change < 0 ? "delta-down" : ""}">${signed(change)}</span>`
        : "No games yet";
      const items = c.items.map((it) => `<li><span class="change-kind ${it.kind.toLowerCase()}">${it.kind}</span><span>${it.text}</span></li>`).join("");
      return `<li class="change">
        <div class="change-when"><time>${c.date}</time><span>from game ${c.fromGame}</span></div>
        <div class="change-main">
          <ul class="change-items">${items}</ul>
          <p class="change-stats">${then}<br>${since}</p>
        </div>
      </li>`;
    })
    .join("");
}

fetch("/api/games")
  .then((r) => r.json() as Promise<Summary>)
  .then((s) => render(s.history))
  .catch(() => ($("changes").innerHTML = `<li class="empty">Couldn't load the log. Refresh to try again.</li>`));
