import "./theme";
import { START_RATING } from "../../src/core/elo";
import { CHANGES, TESTING, type Change } from "./changes";

interface Summary {
  history: { id: number; rating: number; score: number }[];
}

const $ = (id: string) => document.getElementById(id)!;

const record = (games: Summary["history"]) => {
  const n = (s: number) => games.filter((g) => g.score === s).length;
  return `${n(1)} W · ${n(0.5)} D · ${n(0)} L`;
};
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

const signedSpan = (n: number) => `<span class="${n > 0 ? "delta-up" : n < 0 ? "delta-down" : ""}">${signed(n)}</span>`;

const entry = (c: Change, stats: string) => {
  const items = c.items.map((it) => `<li><span class="change-kind ${it.kind.toLowerCase()}">${it.kind}</span><span>${it.text}</span></li>`).join("");
  return `<li class="change">
    <div class="change-when"><time>${c.date}</time><span>from game ${c.fromGame}</span></div>
    <div class="change-main">
      <ul class="change-items">${items}</ul>
      <p class="change-stats">${stats}</p>
    </div>
  </li>`;
};

// Each release as a timeline entry: what changed, where Jev stood when it went live, and how it did until the next.
// Releases since the restart are worked out from the live games; the testing period's are frozen from the archive.
function render(history: Summary["history"]) {
  const current = CHANGES.filter((c) => !c.frozen);
  const testing = CHANGES.filter((c) => c.frozen);
  const live = current.map((c, i) => {
    const until = i === 0 ? Infinity : current[i - 1]!.fromGame;
    const before = history.filter((g) => g.id < c.fromGame);
    const during = history.filter((g) => g.id >= c.fromGame && g.id < until);
    const ratingThen = before.at(-1)?.rating ?? START_RATING;
    const change = (during.at(-1)?.rating ?? ratingThen) - ratingThen;
    const then = `Rating ${ratingThen}${before.length ? ` · ${record(before)}` : ""}`;
    const since = during.length ? `${i === 0 ? "Since" : "Then"}: ${during.length} ${during.length === 1 ? "game" : "games"} · ${record(during)} · ${signedSpan(change)}` : "No games yet";
    return entry(c, `${then}<br>${since}`);
  });
  const frozen = testing.map((c) => entry(c, `${c.frozen!.then}<br>Then: ${c.frozen!.during} · ${signedSpan(c.frozen!.change)}`));
  const divider = `<li class="change-era"><h2>Testing period</h2><p>${TESTING.dates} · ${TESTING.summary}. These games were cleared at the restart; the numbers below are as they stood.</p></li>`;
  $("changes").innerHTML = [...live, divider, ...frozen].join("");
}

fetch("/api/games")
  .then((r) => r.json() as Promise<Summary>)
  .then((s) => render(s.history))
  .catch(() => ($("changes").innerHTML = `<li class="empty">Couldn't load the log. Refresh to try again.</li>`));
