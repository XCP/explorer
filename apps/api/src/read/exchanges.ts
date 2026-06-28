/**
 * /v2/exchanges — the CEX side of Counterparty history. The is_exchange addresses are curated (src/indexer/
 * curated.ts), here labelled by operator and shown with their flow: distinct assets handled, inbound senders,
 * activity span. Plus the assets that most moved onto exchanges (the historically CEX-listed tokens).
 */
import { router, J } from "./shared";

// operator names for the curated exchange addresses (from curated.ts comments — facts, not heuristics)
const NAMES: Record<string, string> = {
  "1AeqgtHedfA2yVXH6GiKLS2JGkfWfgyTC6": "Bittrex",
  "1XCPdWb6kk7PGfvbdRbRuNh51aPc4vqC7": "Poloniex", "1Po1oXMCWobE6kxWr8rJEP1SRq71JSD3t4": "Poloniex",
  "1BCYpzZAmH3pX7EXU6s4gxtG1AoVMn2NfJ": "Poloniex", "1GEMZsZZQ32YqX3nzBptQLJBAtn1XByRCZ": "Poloniex",
  "1SJCXrYsuWmZzmAhA9K4fYkKqgGyLim79": "Poloniex", "1FLDCfr9iG7n6bAdGsqBXmhaLgC4aSze72": "Poloniex",
  "1LTBCyh9dKhNNZFaByPXfrkeuAD7yr6A4b": "Poloniex", "15ctNNSfo84dW5Ki8fTkcqbFAyfGbBXwsC": "Poloniex",
  "1PNkBxnz5ePW8FeK6CSs8V2fGHcN9B6HNk": "Zaif", "1AhAExgxS6aVRdKdyEuC5M4v6dxdzdgTaq": "Zaif",
  "1F2zjMv6dTwTW4r9fJ7zTonXp7Tfk23su3": "Zaif", "3DZzgGNxsSK1XyUJcKHLM9PxLTEypPGo8W": "Zaif",
  "1ML2b9tY5V8S9qQw6jNUs5uxkm6nKayk6x": "Zaif", "1E1QuzwVeLdnQdNq38gBsyH8ht39UdHPAh": "Zaif",
  "1PH4KzJ7VpwPZR3VnP8anmcMTjJEGt73Gz": "Zaif/Tech Bureau", "14rR75DYPaKLSt6UHBakR2h3n8QadTEGxG": "Zaif/Tech Bureau",
  "1N9XWkNp4zPykh8kajbwJXY5d5ZzkQXs3L": "Huobi",
};

export const exchanges = router();

exchanges.get("/v2/exchanges", async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).all().then((r) => r.results).catch(() => []);
  const [list, topAssets, summary] = await Promise.all([
    q(`SELECT addr, assets_received, in_peers, first_blk, last_blk FROM address_signals WHERE is_exchange=1 ORDER BY in_peers DESC`),
    // assets that most moved onto exchanges (distinct depositors per asset = CEX-listed / liquid history)
    q(`SELECT s.asset, a.asset_longname, COUNT(DISTINCT s.source) depositors FROM sends s JOIN address_signals e ON e.addr=s.destination AND e.is_exchange=1 LEFT JOIN assets a ON a.asset=s.asset WHERE s.asset NOT IN ('XCP','BTC') GROUP BY s.asset ORDER BY depositors DESC LIMIT 15`),
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM address_signals WHERE is_exchange=1) exchanges, (SELECT COUNT(*) FROM address_signals WHERE is_deposit=1) deposit_addresses`).first<any>().catch(() => null),
  ]);
  const exchangesOut = (list as any[]).map((r) => ({ ...r, name: NAMES[r.addr] ?? "Exchange" }));
  return J(c, { result: { summary, exchanges: exchangesOut, top_assets: topAssets }, }, 600);
});
