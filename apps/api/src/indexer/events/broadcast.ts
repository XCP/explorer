/** BROADCAST — an oracle/feed message (timestamp + value + text). Drives bet feeds and price oracles.
 *  Bet settlement side-effects arrive as separate CREDIT/DEBIT + bet-match events. We also TAG broadcasts
 *  that are BTNS (Broadcast Token Naming System) commands — see btns.ts (tag only, not implemented). */
import { type Handler, str, cap } from "./context";
import { classifyBtns } from "./btns";

const broadcast: Handler = ({ p, b, bt }, ctx) => {
  const bn = classifyBtns(p.text);
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR REPLACE INTO broadcasts (tx_hash,block_index,block_time,source,timestamp,value,fee_fraction_int,text,locked,mime_type,status,btns,btns_op,btns_tick) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(p.tx_hash, b, bt, p.source ?? null, p.timestamp ?? null, str(p.value), str(p.fee_fraction_int),
         cap(p.text), p.locked ? 1 : 0, p.mime_type ?? null, p.status ?? "valid",
         bn ? 1 : null, bn?.op ?? null, bn?.tick ?? null));
};

export const broadcasts: Record<string, Handler> = { BROADCAST: broadcast };
