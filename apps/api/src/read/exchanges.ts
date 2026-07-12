/**
 * GET /v2/exchanges — the CEX side of Counterparty history. The is_exchange addresses are curated (src/indexer/
 * curated.ts), here labelled by operator and shown with their flow: distinct assets handled, inbound senders,
 * activity span. Plus the assets that most moved onto exchanges. Thin route over queries/exchanges.ts.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { ExchangesPayload, ExchangeRow } from "@xcp/shared/addresses";
import { router, cached } from "./respond";
import { exchangeWallets, exchangeTopAssets, exchangeSummary } from "../queries/exchanges";
import { exchangeNames } from "../queries/curated";

export const exchanges = router();

exchanges.get("/v2/exchanges", (c) =>
  cached(c, "exchanges", { ttl: 600, edge: 120, swr: 86400 }, async (): Promise<Envelope<ExchangesPayload>> => {
    const db = c.env.DB;
    // operator names come from the curated table (kind='exchange_name'); unlabelled wallets show "Exchange".
    const [list, top_assets, summary, names] = await Promise.all([
      exchangeWallets(db).catch(() => []),
      exchangeTopAssets(db).catch(() => []),
      exchangeSummary(db).catch(() => null),
      exchangeNames(db).catch(() => ({} as Record<string, string>)),
    ]);
    const exchangesOut: ExchangeRow[] = list.map((r) => ({ ...r, name: names[r.address] ?? "Exchange" }));
    return { result: { summary, exchanges: exchangesOut, top_assets } };
  }));
