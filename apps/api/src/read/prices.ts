/**
 * /v2/price + /v2/price/ticker — the explorer's own XCP price, served with provenance.
 * The ticker is the header's 60-second quote; the page payload carries the full daily history,
 * the source eras, and the last-30-day on-chain execution evidence. The ticker uses the current
 * confirmed one-XCP dispenser ask when available. The daily calendar remains the stable source
 * for charts, performance, and historical accounting.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { PriceCandles, PricePage, PriceTicker } from "@xcp/shared/prices";
import { router, J, cached } from "#api/read/respond";
import {
  latestMarketEdge,
  latestPrice,
  latestXcpUnitDispenserAsk,
  onChainVenueEvidence,
  priceBefore,
  xcpDailyCandles,
  xcpHistory,
  xcpSourceEras,
} from "#api/queries/prices";

const changePct = (now: number, prior: number | null | undefined): number | null =>
  prior && prior > 0 ? Math.round(((now - prior) / prior) * 1000) / 10 : null;

export const prices = router();

prices.get("/v2/price/ticker", async (c) => {
  const db = c.env.CORE_DB;
  const [xcp, btc, ask] = await Promise.all([
    latestPrice(db, "XCP"),
    latestPrice(db, "BTC"),
    latestXcpUnitDispenserAsk(db),
  ]);
  const [xcpPrior, btcPrior] = await Promise.all([
    xcp ? priceBefore(db, "XCP", xcp.day) : null,
    btc ? priceBefore(db, "BTC", btc.day) : null,
  ]);
  const body: Envelope<PriceTicker> = {
    result: {
      as_of: Math.floor(Date.now() / 1000),
      xcp:
        ask && btc
          ? {
              usd: Math.round(((ask.sats / 1e8) * btc.usd + Number.EPSILON) * 1e8) / 1e8,
              change_pct: null,
              sats: ask.sats,
              quote: "confirmed_unit_dispenser_ask",
            }
          : xcp
            ? {
                usd: xcp.usd,
                change_pct: changePct(xcp.usd, xcpPrior?.usd),
                sats: null,
                quote: "daily_reference",
              }
            : null,
      btc: btc ? { usd: btc.usd, change_pct: changePct(btc.usd, btcPrior?.usd) } : null,
    },
  };
  return J(c, body, 60);
});

// The /price page's candle tape: daily on-chain XCP/BTC OHLC over raw fills. New fills land at
// most a few times a day, so an hour-long TTL with a day of stale-while-revalidate is generous.
prices.get("/v2/price/ohlc", (c) =>
  cached(c, "price:ohlc:2", { ttl: 3600, edge: 600, swr: 86_400 }, async (): Promise<Envelope<PriceCandles>> => ({
    result: { as_of: Math.floor(Date.now() / 1000), candles: await xcpDailyCandles(c.env.CORE_DB) },
  })),
);

prices.get("/v2/price", (c) =>
  cached(c, "price:page:4", { ttl: 600, edge: 300, swr: 3600 }, async (): Promise<Envelope<PricePage>> => {
    const db = c.env.CORE_DB;
    const [xcp, btc, history, sources, sats, venues] = await Promise.all([
      latestPrice(db, "XCP"),
      latestPrice(db, "BTC"),
      xcpHistory(db),
      xcpSourceEras(db),
      latestMarketEdge(db),
      onChainVenueEvidence(db, new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
    ]);
    const prior = xcp ? await priceBefore(db, "XCP", xcp.day) : null;
    let ath = null as PricePage["ath"];
    for (const point of history) if (!ath || point.usd > ath.usd) ath = point;
    return {
      result: {
        as_of: Math.floor(Date.now() / 1000),
        xcp,
        btc,
        change_pct: xcp ? changePct(xcp.usd, prior?.usd) : null,
        sats,
        ath,
        history,
        sources,
        venues_30d: venues,
      },
    };
  }),
);
