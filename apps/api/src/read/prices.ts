/**
 * /v2/price + /v2/price/ticker — the explorer's own XCP price, served with provenance.
 * The ticker is the header's 60-second quote; the page payload carries the full daily history,
 * the source eras, and the last-30-day on-chain execution evidence. Both read the same reviewed
 * calendar that values every trade on the site — the header number IS the site's number.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { PricePage, PriceTicker } from "@xcp/shared/prices";
import { router, J, cached } from "#api/read/respond";
import {
  latestMarketEdge,
  latestPrice,
  onChainVenueEvidence,
  priceBefore,
  xcpHistory,
  xcpSourceEras,
} from "#api/queries/prices";

const changePct = (now: number, prior: number | null | undefined): number | null =>
  prior && prior > 0 ? Math.round(((now - prior) / prior) * 1000) / 10 : null;

export const prices = router();

prices.get("/v2/price/ticker", async (c) => {
  const db = c.env.CORE_DB;
  const [xcp, btc] = await Promise.all([latestPrice(db, "XCP"), latestPrice(db, "BTC")]);
  const [xcpPrior, btcPrior] = await Promise.all([
    xcp ? priceBefore(db, "XCP", xcp.day) : null,
    btc ? priceBefore(db, "BTC", btc.day) : null,
  ]);
  const body: Envelope<PriceTicker> = {
    result: {
      as_of: Math.floor(Date.now() / 1000),
      xcp: xcp ? { usd: xcp.usd, change_pct: changePct(xcp.usd, xcpPrior?.usd) } : null,
      btc: btc ? { usd: btc.usd, change_pct: changePct(btc.usd, btcPrior?.usd) } : null,
    },
  };
  return J(c, body, 60);
});

prices.get("/v2/price", (c) =>
  cached(c, "price:page:1", { ttl: 600, edge: 300, swr: 3600 }, async (): Promise<Envelope<PricePage>> => {
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
