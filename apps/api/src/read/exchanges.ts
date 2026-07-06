/**
 * GET /v2/exchanges — the CEX side of Counterparty history. The is_exchange addresses are curated (src/indexer/
 * curated.ts), here labelled by operator and shown with their flow: distinct assets handled, inbound senders,
 * activity span. Plus the assets that most moved onto exchanges. Thin route over queries/exchanges.ts.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { ExchangesPayload, ExchangeRow } from "@xcp/shared/addresses";
import { router, cached } from "./respond";
import { exchangeWallets, exchangeTopAssets, exchangeSummary } from "../queries/exchanges";

// operator names for the curated exchange addresses (from curated.ts comments — facts, not heuristics).
// SCHEDULED to move to a curated table; kept inline for now (behavior must stay identical).
const NAMES: Record<string, string> = {
  "1AeqgtHedfA2yVXH6GiKLS2JGkfWfgyTC6": "Bittrex",
  "1XCPdWb6kk7PGfvbdRbRuNh51aPc4vqC7": "Poloniex", "1Po1oXMCWobE6kxWr8rJEP1SRq71JSD3t4": "Poloniex",
  "1BCYpzZAmH3pX7EXU6s4gxtG1AoVMn2NfJ": "Poloniex", "1GEMZsZZQ32YqX3nzBptQLJBAtn1XByRCZ": "Poloniex",
  "1SJCXrYsuWmZzmAhA9K4fYkKqgGyLim79": "Poloniex", "1FLDCfr9iG7n6bAdGsqBXmhaLgC4aSze72": "Poloniex",
  "1LTBCyh9dKhNNZFaByPXfrkeuAD7yr6A4b": "Poloniex", "15ctNNSfo84dW5Ki8fTkcqbFAyfGbBXwsC": "Poloniex",
  "1Co1dcFX6u1wQ8cW8mnj1DEgW7xQMEaChD": "Poloniex",
  "1PNkBxnz5ePW8FeK6CSs8V2fGHcN9B6HNk": "Zaif", "1AhAExgxS6aVRdKdyEuC5M4v6dxdzdgTaq": "Zaif",
  "1F2zjMv6dTwTW4r9fJ7zTonXp7Tfk23su3": "Zaif", "3DZzgGNxsSK1XyUJcKHLM9PxLTEypPGo8W": "Zaif",
  "1ML2b9tY5V8S9qQw6jNUs5uxkm6nKayk6x": "Zaif", "1E1QuzwVeLdnQdNq38gBsyH8ht39UdHPAh": "Zaif",
  "1PH4KzJ7VpwPZR3VnP8anmcMTjJEGt73Gz": "Zaif/Tech Bureau", "14rR75DYPaKLSt6UHBakR2h3n8QadTEGxG": "Zaif/Tech Bureau",
  "1N9XWkNp4zPykh8kajbwJXY5d5ZzkQXs3L": "Huobi",
};

export const exchanges = router();

exchanges.get("/v2/exchanges", (c) =>
  cached(c, "exchanges", { ttl: 600, edge: 120 }, async (): Promise<Envelope<ExchangesPayload>> => {
    const db = c.env.DB;
    const [list, top_assets, summary] = await Promise.all([
      exchangeWallets(db).catch(() => []),
      exchangeTopAssets(db).catch(() => []),
      exchangeSummary(db).catch(() => null),
    ]);
    const exchangesOut: ExchangeRow[] = list.map((r) => ({ ...r, name: NAMES[r.addr] ?? "Exchange" }));
    return { result: { summary, exchanges: exchangesOut, top_assets } };
  }));
