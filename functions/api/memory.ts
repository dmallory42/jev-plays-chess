import { FLAG_MIN_PLAYED } from "../../src/core/memory";
import { json, storeFor, type Env } from "./_shared";

// What Jev has learned: the kinds of move that keep going wrong, and its record with each opening line.
export async function GET(_request: Request, context: { env: Env }) {
  const store = await storeFor(context.env);
  const [patterns, openings] = await Promise.all([store.allPatterns(FLAG_MIN_PLAYED, 40), store.allOpenings(2, 300)]);
  return json({ patterns, openings }, { headers: { "cache-control": "public, max-age=60" } });
}
