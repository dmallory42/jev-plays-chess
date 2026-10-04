import "./theme";
import { figurine } from "./notation";

interface Pattern {
  key: string;
  text: string;
  played: number;
  wrong: number;
  lastGame: number;
}
interface Opening {
  key: string;
  games: number;
  points: number;
}

// Mirrors FLAG_MIN_RATE in src/core/memory.ts: at or above this, Jev is warned about the move.
const FLAG_MIN_RATE = 0.35;
const $ = (id: string) => document.getElementById(id)!;

// "1. e4 e5 2. Nf3" from the stored SAN list, with piece icons.
function line(sans: string[]) {
  return sans
    .map((san, i) => `${i % 2 === 0 ? `<span class="num">${i / 2 + 1}.</span>` : ""}${figurine(san, i % 2 === 0 ? "w" : "b")}`)
    .join(" ");
}

function renderPatterns(patterns: Pattern[]) {
  const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  $("pattern-list").innerHTML = patterns.length
    ? patterns
        .map((p) => {
          const rate = p.wrong / p.played;
          const flagged = rate >= FLAG_MIN_RATE;
          return `<li class="${flagged ? "is-flagged" : ""}">
            <span class="pattern-rate">${Math.round(rate * 100)}%</span>
            <span class="pattern-text">${sentence(p.text)}</span>
            <span class="pattern-bar"><span style="width:${(rate * 100).toFixed(1)}%"></span></span>
            <span class="pattern-meta">Went wrong ${p.wrong} of ${p.played} times${flagged ? ". Jev is warned about these" : ""}</span>
          </li>`;
        })
        .join("")
    : `<li class="empty">Nothing yet. Each kind of move appears once Jev has played it a few times.</li>`;
}

function renderOpenings(all: Opening[], side: "w" | "b") {
  const rows = all.filter((o) => o.key.startsWith(`${side}:`)).slice(0, 25);
  $(`openings-${side}`).innerHTML = rows.length
    ? rows
        .map((o) => {
          const pct = Math.round((100 * o.points) / o.games);
          return `<li><span class="opening-line">${line(o.key.slice(2).split(" "))}</span><span class="opening-games">${o.games} games</span><span class="opening-score ${pct >= 55 ? "delta-up" : pct <= 45 ? "delta-down" : ""}">${pct}%</span></li>`;
        })
        .join("")
    : `<li class="empty">Lines show up here once Jev has played them twice.</li>`;
}

async function load() {
  const data = (await (await fetch("/api/memory")).json()) as { patterns: Pattern[]; openings: Opening[] };
  renderPatterns(data.patterns);
  renderOpenings(data.openings, "w");
  renderOpenings(data.openings, "b");
}

load().catch(() => ($("pattern-list").innerHTML = `<li class="empty">Couldn't load what Jev has learned. Refresh to try again.</li>`));
