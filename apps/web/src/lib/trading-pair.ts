// Base/quote pairing — ported from xcpdex so orders/trades read as a market (price in the quote
// asset, amount in the base). The quote is the more "currency-like" side (XCP, BTC, *CASH/*COIN…).
export const QUOTE_ASSETS = [
  "BTC",
  "XCP",
  "XBTC",
  "FLDC",
  "SJCX",
  "BITCRYSTALS",
  "LTBCOIN",
  "SCOTCOIN",
  "PEPECASH",
  "BITCORN",
  "CORNFUTURES",
  "NEWBITCORN",
  "DATABITS",
  "MAFIACASH",
  "PENISIUM",
  "RUSTBITS",
  "WILLCOIN",
  "XFCCOIN",
  "SOVEREIGNC",
  "OLINCOIN",
  "BITROCK",
];
const QUOTE_KEYWORDS = ["CASH", "COIN", "MONEY", "BTC"];
const rank = (s: string) => {
  const i = QUOTE_ASSETS.indexOf(s);
  return i < 0 ? QUOTE_ASSETS.length : i;
};
const isQuote = (s: string) => QUOTE_ASSETS.includes(s);
const isKw = (s: string) => QUOTE_KEYWORDS.some((k) => s.toUpperCase().includes(k));

// returns [base, quote]
export function pair(give: string, get: string): [string, string] {
  if (isQuote(give) && isQuote(get)) return rank(give) < rank(get) ? [get, give] : [give, get];
  if (isQuote(give)) return [get, give];
  if (isQuote(get)) return [give, get];
  if (isKw(give) && isKw(get)) return rank(give) < rank(get) ? [get, give] : [give, get];
  if (isKw(give)) return [get, give];
  if (isKw(get)) return [give, get];
  return give < get ? [give, get] : [get, give];
}

/** A give/get order resolved to market terms: base/quote, quantities, price, and the maker's side. */
export interface MarketView {
  base: string;
  quote: string;
  baseQty: number;
  quoteQty: number;
  price: number;
  direction: "buy" | "sell";
}

interface OrderLike {
  give_asset: string | null;
  get_asset: string | null;
  give_quantity_normalized: number | string | null;
  get_quantity_normalized: number | string | null;
}

export function orderView(o: OrderLike): MarketView {
  const give = o.give_asset ?? "?",
    get = o.get_asset ?? "?";
  const [base, quote] = pair(give, get);
  const giveIsBase = give === base;
  const baseQty = Number(giveIsBase ? o.give_quantity_normalized : o.get_quantity_normalized) || 0;
  const quoteQty = Number(giveIsBase ? o.get_quantity_normalized : o.give_quantity_normalized) || 0;
  return {
    base,
    quote,
    baseQty,
    quoteQty,
    price: baseQty ? quoteQty / baseQty : 0,
    direction: give === quote ? ("buy" as const) : ("sell" as const), // giving the quote => buying the base
  };
}

/** An order match resolved the same way — tx0 gave the forward asset, so forward/backward map to
 *  give/get and `direction` is tx0's side of the trade. */
export function matchView(m: {
  forward_asset: string | null;
  backward_asset: string | null;
  forward_quantity_normalized: number | null;
  backward_quantity_normalized: number | null;
}): MarketView {
  return orderView({
    give_asset: m.forward_asset,
    get_asset: m.backward_asset,
    give_quantity_normalized: m.forward_quantity_normalized,
    get_quantity_normalized: m.backward_quantity_normalized,
  });
}
