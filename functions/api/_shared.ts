import { askJev, buildJevRequest, LIVE_PROMPT } from "../../src/core/jev";
import { moveFacts } from "../../src/core/facts";
import { recall, type Memory } from "../../src/core/memory";
import { SqlStore, type D1Like } from "../../src/core/sql-store";

export interface Env {
  DB: D1Like;
  TYPESAFE_API_KEY?: string;
}

let ready: Promise<void> | null = null;

// One store per request; the schema check runs once per isolate.
export async function storeFor(env: Env) {
  const store = new SqlStore(env.DB);
  ready ??= store.init().catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return store;
}

// Jev with its memory: before each move it's reminded of how moves like each option have gone before.
export function jevFor(env: Env, memory: Memory) {
  const key = env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  return async (chess: Parameters<typeof buildJevRequest>[0], recentSan: string[]) => {
    const all = moveFacts(chess);
    const remembered = await recall(memory, chess, recentSan, all);
    const { request, facts } = buildJevRequest(chess, recentSan, LIVE_PROMPT, remembered, all);
    return { decision: await askJev(key, request, facts), facts, recall: remembered };
  };
}

export const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { "cache-control": "no-store", ...(init.headers ?? {}) } });
