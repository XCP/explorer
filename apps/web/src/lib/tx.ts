/** Transaction-kind display titles — the page headline (tokenscan convention: the TYPE is the title)
 *  and the shared-link metadata both read from this one map. Keys = TxAction.kind. */
export const KIND_TITLE: Record<string, string> = {
  send: "Send", dispense: "Dispense — BTC purchase", dispenser: "Dispenser", refill: "Dispenser refill",
  order: "DEX order", cancel: "Order cancellation", btcpay: "BTCPay — order settlement", issuance: "Issuance",
  fairminter: "Fairminter", fairmint: "Fairmint", broadcast: "Broadcast", sweep: "Sweep",
  dividend: "Dividend", burn: "Proof-of-burn", destruction: "Destruction", bet: "Bet", rps: "Rock-Paper-Scissors",
  pool_liquidity: "Pool liquidity", pool_swap: "Pool swap",
};

/** Short tab label per kind — the first tab is NAMED for what the tx is (the header card stays
 *  "Transaction": the Bitcoin of it all). Falls back to "Overview" for pending/unclassified. */
export const KIND_TAB: Record<string, string> = {
  send: "Send", dispense: "Dispense", dispenser: "Dispenser", refill: "Dispenser",
  order: "Order", cancel: "Cancel", btcpay: "BTCPay", issuance: "Issuance",
  fairminter: "Fairminter", fairmint: "Fairmint", broadcast: "Broadcast", sweep: "Sweep",
  dividend: "Dividend", burn: "Burn", destruction: "Destruction", bet: "Bet", rps: "RPS",
  pool_liquidity: "Pool", pool_swap: "Swap",
};

import { fromSats, commas } from "./format";

/** satoshi value → trimmed BTC display ("0.0299 BTC"). */
export const btcAmt = (sats?: string | number | null): string => {
  const v = fromSats(sats, 1);
  return v == null ? "—" : `${v.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0")} BTC`;
};
/** XCP-satoshi value → "1,650 XCP". */
export const xcpAmt = (sats?: string | number | null): string => {
  const v = fromSats(sats, 1);
  return v == null ? "—" : `${commas(v)} XCP`;
};
/** sats → USD at the given BTC price ("≈ $1,891"); null when either side is unknown. */
export const satsUsd = (sats?: string | number | null, btcUsd?: number | null): string | null => {
  const v = fromSats(sats, 1);
  if (v == null || btcUsd == null) return null;
  const usd = v * btcUsd;
  return `≈ $${commas(usd >= 100 ? Math.round(usd) : usd.toFixed(2))}`;
};
/** blocks-from-now → a human ETA ("≈ 2d 21h") at Bitcoin's ~10-minute cadence. */
export const blocksEta = (blocks: number): string => {
  if (blocks <= 0) return "now";
  const mins = blocks * 10;
  if (mins < 60) return `≈ ${mins}m`;
  const h = Math.floor(mins / 60), d = Math.floor(h / 24);
  return d > 0 ? `≈ ${d}d ${h % 24}h` : `≈ ${h}h ${mins % 60}m`;
};
