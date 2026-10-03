import { handleApi } from "../../src/server/app";
import type { D1Like } from "../../src/core/sql-store";

interface Env {
  DB: D1Like;
  TYPESAFE_API_KEY?: string;
}

// Spacefast runs each file under functions/ as a route; they all hand the request to the shared app.
export async function handle(request: Request, context: { env: Env }) {
  const res = await handleApi(request, { db: context.env.DB, dialect: "mysql", typesafeApiKey: context.env.TYPESAFE_API_KEY });
  return res ?? new Response("Not found", { status: 404 });
}
