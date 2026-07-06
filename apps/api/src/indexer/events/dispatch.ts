/**
 * Event router. Merges every message type's handler map and dispatches one Counterparty event to the right handler.
 * This is the single place to see exactly which events we mirror — `HANDLED_EVENTS` is the source of truth
 * for the fetch filter, so coverage can't silently drift from the handlers.
 */
import type { Ev, Ctx, Handler } from "./context";
import { block } from "./block";
import { transaction } from "./transaction";
import { balance } from "./balance";
import { sends } from "./send";
import { issuances } from "./issuance";
import { destroy_ } from "./destroy";
import { burns } from "./burn";
import { dispensers } from "./dispenser";
import { orders } from "./order";
import { pools } from "./pool";
import { sweeps } from "./sweep";
import { dividends } from "./dividend";
import { broadcasts } from "./broadcast";
import { fairminters } from "./fairminter";
import { bets } from "./bet";
import { rps } from "./rps";

const HANDLERS: Record<string, Handler> = {
  ...block, ...transaction, ...balance, ...sends, ...issuances, ...destroy_, ...burns,
  ...dispensers, ...orders, ...pools, ...sweeps, ...dividends, ...broadcasts, ...fairminters,
  ...bets, ...rps,
};

export function dispatch(ev: Ev, ctx: Ctx): void {
  const p = ev.params || {};
  const b = ev.block_index ?? p.block_index;
  if (b > ctx.maxBlock) ctx.maxBlock = b;
  const h = HANDLERS[ev.event];
  if (h) h({ ev, p, b, bt: p.block_time ?? null, div: !!(p.asset_info && p.asset_info.divisible) }, ctx);
}

// Every event name we have a handler for — used to build the stream fetch filter (single source of truth).
export const HANDLED_EVENTS = Object.keys(HANDLERS);
