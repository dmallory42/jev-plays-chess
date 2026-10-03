import type { Chess } from "chess.js";
import { moveFacts, PIECE_NAME, positionFacts, replyDangers, type MoveFacts } from "./facts";
import type { Recall } from "./memory";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
// Input price per token in USD; output is free.
export const JEV_INPUT_PRICE = 0.042 / 1_000_000;

// General advice a coach would give. It contains no analysis of the position.
const PRINCIPLES = [
  "A move marked CHECKMATE wins the game immediately.",
  "Avoid moves that lose material, unless they give checkmate.",
  "Take material when you can win it safely.",
  "Deal with threats against your pieces.",
  "In the opening, develop knights and bishops, fight for the centre and castle.",
  "When ahead in material, trade pieces. When behind, avoid trades and look for chances.",
];

export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, unknown>;
}

export interface JevDecision {
  san: string;
  uci: string;
  confidence: number;
  /** Every legal move with its probability, highest first. */
  options: { san: string; uci: string; p: number }[];
  inputTokens: number;
  /** Probability that Jev thinks it should resign, 0 to 1. */
  resign: number;
  latencyMs: number;
  model: string;
}

/** Presentation options, compared in the tournament harness. The live site uses the defaults. */
export interface PromptOptions {
  /** Lead each option with its net material outcome. */
  net?: boolean;
  /** Label each option's category and list them grouped: checkmate, wins material, safe, loses material. */
  group?: boolean;
  /** List options in reverse, for asking twice with a different order. */
  reverse?: boolean;
  /** Add what the opponent can do next: mates in one and forks. Folds their cost into net and category. */
  lookahead?: boolean;
  /** Show only the category, net outcome and check, dropping the detailed facts. */
  minimal?: boolean;
}

const CATEGORY_ORDER = ["checkmate", "wins material", "safe", "loses material", "allows checkmate"] as const;

// What the live site uses: +245 rating points over plain facts in a 300-game test against Maia 700.
export const LIVE_PROMPT: PromptOptions = { group: true, net: true };

export const category = (f: MoveFacts, allowsMate = false): (typeof CATEGORY_ORDER)[number] =>
  f.netGain >= 1000 ? "checkmate" : allowsMate ? "allows checkmate" : f.netGain > 0 ? "wins material" : f.netGain < 0 ? "loses material" : "safe";

const netLabel = (n: number) => (n >= 1000 ? "checkmate" : n > 0 ? `+${n} (you come out ${n} ahead)` : n < 0 ? `${n} (you come out ${-n} behind)` : "0 (no material changes hands)");

export function buildJevRequest(chess: Chess, recentSan: string[], opts: PromptOptions = {}, recall?: Recall, precomputed?: MoveFacts[]): { request: JevRequest; facts: MoveFacts[] } {
  const facts = precomputed ?? moveFacts(chess);
  // Looking one reply ahead: mates and forks the opponent would have after each move.
  const ahead = new Map<string, { mate?: string; lines: string[]; forkLoss: number }>();
  if (opts.lookahead) {
    for (const f of facts) {
      if (f.netGain >= 1000) continue;
      chess.move(f.san);
      const d = replyDangers(chess);
      chess.undo();
      const lines: string[] = [];
      if (d.mate) lines.push(`allows them to checkmate you with ${d.mate}`);
      const fork = d.forks[0];
      if (fork) lines.push(`allows ${fork.san}, their ${PIECE_NAME[fork.piece]} forking your ${fork.targets.map((t) => `${PIECE_NAME[t.piece]} on ${t.square}`).join(" and ")} (you can lose ${fork.loss})`);
      ahead.set(f.san, { mate: d.mate, lines, forkLoss: fork?.loss ?? 0 });
    }
  }
  // Net outcome including the worst fork they'd get, when looking ahead.
  const netOf = (f: MoveFacts) => (f.netGain >= 1000 ? f.netGain : f.netGain - Math.max(0, (ahead.get(f.san)?.forkLoss ?? 0) - Math.max(0, f.netGain)));
  const catOf = (f: MoveFacts) => category({ ...f, netGain: netOf(f) }, Boolean(ahead.get(f.san)?.mate));
  let ordered = opts.group ? [...facts].sort((a, b) => CATEGORY_ORDER.indexOf(catOf(a)) - CATEGORY_ORDER.indexOf(catOf(b))) : facts;
  if (opts.reverse) ordered = [...ordered].reverse();
  const criteria: Record<string, unknown> = {};
  for (const f of ordered) {
    const { san: _san, uci: _uci, netGain: _net, tags: _tags, ...shown } = f;
    const next = ahead.get(f.san)?.lines ?? [];
    criteria[f.san] = {
      ...(opts.group ? { category: catOf(f) } : {}),
      ...(opts.net ? { net_material: netLabel(netOf(f)) } : {}),
      ...(opts.minimal ? (f.check ? { check: f.check } : {}) : shown),
      ...(next.length ? { their_reply: next } : {}),
      ...(recall?.history[f.san] ? { your_history: recall.history[f.san] } : {}),
      ...(recall?.openings[f.san] ? { your_record: recall.openings[f.san] } : {}),
    };
  }
  const readingNotes = [
    ...(opts.net ? ["net_material is the overall material result of the move once the exchanges it starts are over and any piece it leaves hanging is taken. Negative means you lose material."] : []),
    ...(opts.group ? ["Each move has a category: checkmate, wins material, safe (no material lost) or loses material. Prefer checkmate, then winning material, then safe moves."] : []),
    ...(opts.lookahead ? ["their_reply lists a checkmate or fork the opponent would have straight after your move. Moves in the category allows checkmate lose the game."] : []),
    ...(recall && Object.keys(recall.history).length ? ["your_history means moves of this kind have often lost you material or the game in your past games."] : []),
    ...(recall && Object.keys(recall.openings).length ? ["your_record is how you have scored in past games after playing this opening move."] : []),
  ];
  const state = positionFacts(chess, recentSan);
  return {
    facts,
    request: {
      model: JEV_MODEL,
      state,
      questions: {
        move: {
          type: "choice",
          instructions: {
            question: `You are playing chess as ${state.you_play}. Which move should you play?`,
            how_to_read:
              "Each option is one legal move in standard algebraic notation. The facts listed with it (captures, checks, material won or lost, pieces left open to capture, threats) were worked out by an exact helper and are correct.",
            ...(readingNotes.length ? { important: readingNotes } : {}),
            principles: PRINCIPLES,
          },
          criteria,
        },
        // Asked alongside the move; code only acts on it when it's confidently yes twice running.
        resign: {
          type: "noul",
          instructions: {
            question: `Is your position (${state.you_play}) so clearly lost that a sensible player would resign now instead of playing on?`,
            consider: "The material balance, threats against your pieces, and whether any move gives real counterplay. Being behind is not enough on its own; resign only when there is no realistic hope.",
          },
        },
      },
    },
  };
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export async function askJev(
  apiKey: string,
  request: JevRequest,
  facts: MoveFacts[],
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number } = {},
): Promise<JevDecision> {
  const started = Date.now();
  let res: Response | undefined;
  // Rate limits, server errors and timeouts are retried with backoff, as TypeSafe's API docs ask.
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= (opts.retries ?? 3);
    try {
      res = await (opts.fetchImpl ?? fetch)(JEV_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (!(res.status === 429 || res.status >= 500) || last) break;
    } catch (e) {
      if (last) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { model: string; answers: { move: ChoiceAnswer; resign?: { noul: number } }; usage?: { input_tokens?: number } };
  const answer = body.answers.move;
  const bySan = new Map(facts.map((f) => [f.san, f]));
  const chosen = bySan.get(answer.choice);
  if (!chosen) throw new Error(`Jev chose an unknown move: ${answer.choice}`);
  const options = Object.entries(answer.probabilities)
    .map(([san, p]) => ({ san, uci: bySan.get(san)?.uci ?? "", p }))
    .sort((a, b) => b.p - a.p);
  return {
    san: chosen.san,
    uci: chosen.uci,
    confidence: answer.confidence,
    options,
    resign: body.answers.resign?.noul ?? 0,
    inputTokens: body.usage?.input_tokens ?? 0,
    latencyMs: Date.now() - started,
    model: body.model,
  };
}
