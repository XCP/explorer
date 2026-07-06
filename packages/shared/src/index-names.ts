/**
 * The explorer's list-index catalog — the single source of truth for which /v2/<name> list
 * endpoints exist. The web registry derives its routes and column defs from this union;
 * adding an index starts here.
 */
export const INDEX_NAMES = [
  "transactions",
  "sends",
  "issuances",
  "dispensers",
  "dispenses",
  "orders",
  "order_matches",
  "sweeps",
  "fairminters",
  "fairmints",
  "destructions",
  "burns",
  "dividends",
  "broadcasts",
  "btcpays",
  "bets",
  "bet_matches",
  "rps",
  "rps_matches",
  "pools",
  "pool_matches",
] as const;

export type IndexName = (typeof INDEX_NAMES)[number];
