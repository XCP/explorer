// Base/quote pairing — ported from xcpdex so orders/trades read as a market (price in the quote
// asset, amount in the base). The quote is the more "currency-like" side (XCP, BTC, *CASH/*COIN…).
export const QUOTE_ASSETS = [
  "BTC", "XCP", "XBTC", "FLDC", "SJCX", "BITCRYSTALS", "LTBCOIN", "SCOTCOIN",
  "PEPECASH", "BITCORN", "CORNFUTURES", "NEWBITCORN", "DATABITS", "MAFIACASH",
  "PENISIUM", "RUSTBITS", "WILLCOIN", "XFCCOIN", "SOVEREIGNC", "OLINCOIN", "BITROCK",
];
const QUOTE_KEYWORDS = ["CASH", "COIN", "MONEY", "BTC"];
const rank = (s: string) => { const i = QUOTE_ASSETS.indexOf(s); return i < 0 ? QUOTE_ASSETS.length : i; };
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

// order needs: give_asset, get_asset, give_quantity_normalized, get_quantity_normalized
export function orderView(o: any) {
  const [base, quote] = pair(o.give_asset, o.get_asset);
  const giveIsBase = o.give_asset === base;
  const baseQty = Number(giveIsBase ? o.give_quantity_normalized : o.get_quantity_normalized) || 0;
  const quoteQty = Number(giveIsBase ? o.get_quantity_normalized : o.give_quantity_normalized) || 0;
  return {
    base, quote, baseQty, quoteQty,
    price: baseQty ? quoteQty / baseQty : 0,
    direction: o.give_asset === quote ? ("buy" as const) : ("sell" as const), // giving the quote => buying the base
  };
}
