import "./theme";

interface Pattern {
  key: string;
  text: string;
  played: number;
  wrong: number;
  lastGame: number;
}
interface Opening {
  side: "w" | "b";
  eco: string;
  name: string;
  family: string;
  games: number;
  points: number;
}

// Mirrors FLAG_MIN_RATE in src/core/memory.ts: at or above this, Jev is warned about the move.
const FLAG_MIN_RATE = 0.35;
const $ = (id: string) => document.getElementById(id)!;

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

const score = (games: number, points: number) => {
  const pct = Math.round((100 * points) / games);
  return `<span class="opening-games">${games} ${games === 1 ? "game" : "games"}</span><span class="opening-score ${pct >= 55 ? "delta-up" : pct <= 45 ? "delta-down" : ""}">${pct}%</span>`;
};

// One row per opening family, most played first, with its named variations underneath.
function renderOpenings(all: Opening[], side: "w" | "b") {
  const families = new Map<string, Opening[]>();
  for (const o of all.filter((o) => o.side === side)) families.set(o.family, [...(families.get(o.family) ?? []), o]);
  const rows = [...families.entries()]
    .map(([family, variations]) => ({ family, variations, games: variations.reduce((n, v) => n + v.games, 0), points: variations.reduce((n, v) => n + v.points, 0) }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 20);
  $(`openings-${side}`).innerHTML = rows.length
    ? rows
        .map((f) => {
          const named = f.variations.filter((v) => v.name !== f.family);
          const variations = named.length
            ? `<ul class="opening-variations">${f.variations
                .map((v) => `<li><span class="opening-name">${v.name === f.family ? "Main line" : v.name.slice(f.family.length + 2)} <span class="opening-eco">${v.eco}</span></span>${score(v.games, v.points)}</li>`)
                .join("")}</ul>`
            : "";
          const eco = named.length ? "" : ` <span class="opening-eco">${f.variations[0]!.eco}</span>`;
          return `<li><div class="opening-row"><span class="opening-family">${f.family}${eco}</span>${score(f.games, f.points)}</div>${variations}</li>`;
        })
        .join("")
    : `<li class="empty">Openings show up here once Jev has finished a game.</li>`;
}

async function load() {
  const data = (await (await fetch("/api/memory")).json()) as { patterns: Pattern[]; openings: Opening[] };
  renderPatterns(data.patterns);
  renderOpenings(data.openings, "w");
  renderOpenings(data.openings, "b");
}

load().catch(() => ($("pattern-list").innerHTML = `<li class="empty">Couldn't load what Jev has learned. Refresh to try again.</li>`));
