/**
 * Event router. Merges every message type's handler map and dispatches one Counterparty event to the right handler.
 * This is the single place to see exactly which events we mirror — `HANDLED_EVENTS` is the source of truth
 * for the fetch filter, so coverage can't silently drift from the handlers.
 */
import type { Ev, Ctx, Handler } from "#api/indexer/events/context";
import { block } from "#api/indexer/events/block";
import { transaction } from "#api/indexer/events/transaction";
import { balance } from "#api/indexer/events/balance";
import { sends } from "#api/indexer/events/send";
import { issuances } from "#api/indexer/events/issuance";
import { destroy_ } from "#api/indexer/events/destroy";
import { burns } from "#api/indexer/events/burn";
import { dispensers } from "#api/indexer/events/dispenser";
import { orders } from "#api/indexer/events/order";
import { pools } from "#api/indexer/events/pool";
import { sweeps } from "#api/indexer/events/sweep";
import { dividends } from "#api/indexer/events/dividend";
import { broadcasts } from "#api/indexer/events/broadcast";
import { fairminters } from "#api/indexer/events/fairminter";
import { bets } from "#api/indexer/events/bet";
import { rps } from "#api/indexer/events/rps";
const HANDLERS: Record<string, Handler> = {
  ...block,
  ...transaction,
  ...balance,
  ...sends,
  ...issuances,
  ...destroy_,
  ...burns,
  ...dispensers,
  ...orders,
  ...pools,
  ...sweeps,
  ...dividends,
  ...broadcasts,
  ...fairminters,
  ...bets,
  ...rps,
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
