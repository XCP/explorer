import { HTTPException } from "hono/http-exception";
import { fetchXcpDexMarket, XcpDexRequestError } from "#api/integrations/xcpdex";
import { latestUsdQuote } from "#api/queries/markets";
import { J, router } from "#api/read/respond";

export const markets = router();

const assetName = (value: string): string => {
  const asset = value.trim().toUpperCase();
  if (!asset || asset.length > 250 || !/^[A-Z0-9._-]+$/.test(asset)) {
    throw new HTTPException(400, { message: "invalid asset name" });
  }
  return asset;
};

markets.get("/v2/markets/:base/:quote", async (c) => {
  const requestedBase = assetName(c.req.param("base"));
  const requestedQuote = assetName(c.req.param("quote"));
  let market;
  try {
    market = await fetchXcpDexMarket(c.env.XCPDEX, requestedBase, requestedQuote);
  } catch (error) {
    if (error instanceof XcpDexRequestError && error.status === 404) {
      throw new HTTPException(404, { message: "market not found" });
    }
    throw new HTTPException(502, { message: "market data is temporarily unavailable" });
  }
  if (market.baseAsset.toUpperCase() !== requestedBase || market.quoteAsset.toUpperCase() !== requestedQuote) {
    throw new HTTPException(502, { message: "market provider returned a different pair" });
  }
  return J(c, { result: market }, 30);
});

markets.get("/v2/quotes/XCP/USD", async (c) => {
  const quote = await latestUsdQuote(c.env.CORE_DB, "XCP");
  if (!quote || !Number.isFinite(quote.usd) || quote.usd <= 0) {
    throw new HTTPException(503, { message: "XCP/USD quote is temporarily unavailable" });
  }
  return J(
    c,
    {
      result: {
        baseAsset: "XCP",
        quoteAsset: "USD",
        price: quote.usd,
        observedOn: quote.day,
        source: "counterparty_dex",
      },
    },
    60,
  );
});
