// Piece images are bundled as data URIs so a board doesn't fire twelve requests at once.
const PIECE_SVGS = import.meta.glob<string>("../public/pieces/*.svg", { query: "?raw", import: "default", eager: true });
const PIECES: Record<string, string> = {};
for (const [path, svg] of Object.entries(PIECE_SVGS)) PIECES[path.slice(-6, -4)] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export const pieceSrc = (colour: "w" | "b", type: string) => PIECES[colour + type.toUpperCase()]!;

const SQ = 100;
const FILES = "abcdefgh";
const NS = "http://www.w3.org/2000/svg";

export interface Arrow {
  from: string;
  to: string;
  weight: number;
  chosen: boolean;
}

// Board coordinates of a square's top-left corner, with `orientation` at the bottom.
function xy(square: string, orientation: "w" | "b") {
  const f = FILES.indexOf(square[0]!);
  const r = Number(square[1]) - 1;
  return orientation === "w" ? { x: f * SQ, y: (7 - r) * SQ } : { x: (7 - f) * SQ, y: r * SQ };
}

function el(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function layer(svg: SVGSVGElement, id: string) {
  let g = svg.querySelector<SVGGElement>(`#${id}`);
  if (!g) {
    g = el("g", { id }) as SVGGElement;
    svg.appendChild(g);
  }
  return g;
}

export function drawBoard(
  svg: SVGSVGElement,
  fen: string,
  orientation: "w" | "b",
  lastMove: { from: string; to: string; side: "jev" | "opp" } | null,
  animate: boolean,
) {
  const squares = layer(svg, "squares");
  const highlights = layer(svg, "highlights");
  const pieces = layer(svg, "pieces");
  layer(svg, "arrows");

  if (!squares.childElementCount) {
    for (let i = 0; i < 64; i++) {
      const fx = i % 8;
      const ry = Math.floor(i / 8);
      squares.appendChild(el("rect", { x: fx * SQ, y: ry * SQ, width: SQ, height: SQ, class: (fx + ry) % 2 ? "sq-dark" : "sq-light" }));
    }
  }
  // Coordinates follow the orientation, so they are redrawn with it.
  squares.querySelectorAll(".coord").forEach((c) => c.remove());
  for (let i = 0; i < 8; i++) {
    const file = orientation === "w" ? FILES[i]! : FILES[7 - i]!;
    const rank = orientation === "w" ? 8 - i : i + 1;
    const f = el("text", { x: i * SQ + SQ - 8, y: 8 * SQ - 8, "text-anchor": "end", class: "coord" });
    f.textContent = file;
    const r = el("text", { x: 6, y: i * SQ + 22, class: "coord" });
    r.textContent = String(rank);
    squares.append(f, r);
  }

  highlights.replaceChildren();
  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const { x, y } = xy(sq, orientation);
      highlights.appendChild(el("rect", { x, y, width: SQ, height: SQ, class: `last-move ${lastMove.side === "opp" ? "by-maia" : ""}` }));
    }
  }

  pieces.replaceChildren();
  const rows = fen.split(" ")[0]!.split("/");
  rows.forEach((row, ri) => {
    let fi = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        fi += Number(ch);
        continue;
      }
      const square = FILES[fi]! + (8 - ri);
      const colour = ch === ch.toUpperCase() ? "w" : "b";
      const { x, y } = xy(square, orientation);
      const img = el("image", { href: PIECES[colour + ch.toUpperCase()]!, width: SQ, height: SQ, class: "piece" });
      const start = animate && lastMove && square === lastMove.to ? xy(lastMove.from, orientation) : { x, y };
      img.style.transform = `translate(${start.x}px, ${start.y}px)`;
      pieces.appendChild(img);
      if (start.x !== x || start.y !== y) {
        requestAnimationFrame(() => requestAnimationFrame(() => (img.style.transform = `translate(${x}px, ${y}px)`)));
      }
      fi++;
    }
  });
}

// Arrow thickness and opacity follow the probability Jev gave each move.
export function drawArrows(svg: SVGSVGElement, arrows: Arrow[], orientation: "w" | "b") {
  const g = layer(svg, "arrows");
  g.replaceChildren();
  for (const a of [...arrows].sort((p, q) => p.weight - q.weight)) {
    const s = xy(a.from, orientation);
    const t = xy(a.to, orientation);
    const x1 = s.x + SQ / 2;
    const y1 = s.y + SQ / 2;
    const x2 = t.x + SQ / 2;
    const y2 = t.y + SQ / 2;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const w = 8 + 26 * a.weight;
    const head = Math.max(26, w * 1.9);
    const shaft = Math.max(0, len - head);
    const pts = [
      [0, -w / 2],
      [shaft, -w / 2],
      [shaft, -head / 2],
      [len, 0],
      [shaft, head / 2],
      [shaft, w / 2],
      [0, w / 2],
    ]
      .map(([px, py]) => `${px!.toFixed(1)},${py!.toFixed(1)}`)
      .join(" ");
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    g.appendChild(
      el("polygon", {
        points: pts,
        class: "arrow",
        transform: `translate(${x1} ${y1}) rotate(${angle})`,
        opacity: (a.chosen ? 0.85 : 0.3 + 0.6 * a.weight).toFixed(2),
      }),
    );
  }
}
