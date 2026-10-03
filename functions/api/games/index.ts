import { summaryView } from "../../../src/core/views";
import { json, storeFor, type Env } from "../_shared";

export async function GET(_request: Request, context: { env: Env }) {
  const store = await storeFor(context.env);
  return json(await summaryView(store, Date.now()));
}
