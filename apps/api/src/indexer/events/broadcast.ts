/** BROADCAST — an oracle/feed message (timestamp + value + text). Drives bet feeds and price oracles.
 *  Bet settlement side-effects arrive as separate CREDIT/DEBIT + bet-match events. We also TAG broadcasts
 *  that are BTNS (Broadcast Token Naming System) commands — see btns.ts (tag only, not implemented). */
import { type Handler, str, cap } from "#api/indexer/events/context";
import { classifyBtns } from "#api/indexer/events/btns";
import { hashToBytes } from "#api/indexer/compact-codec";
const broadcast: Handler = ({ p, b, bt }, ctx) => {
  const bn = classifyBtns(p.text);
  if (p.source) ctx.identities.addresses.add(String(p.source));
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO broadcasts
           (tx_index,tx_hash,block_index,block_time,source_id,timestamp,value,fee_fraction_int,text,locked,
            mime_type,status,btns,btns_op,btns_tick)
         VALUES (?,?,?,?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tx_index) DO UPDATE SET tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,timestamp=excluded.timestamp,
           value=excluded.value,fee_fraction_int=excluded.fee_fraction_int,text=excluded.text,
           locked=excluded.locked,mime_type=excluded.mime_type,status=excluded.status,btns=excluded.btns,
           btns_op=excluded.btns_op,btns_tick=excluded.btns_tick`,
      )
      .bind(
        p.tx_index,
        hashToBytes(p.tx_hash),
        b,
        bt,
        p.source ?? null,
        p.timestamp ?? null,
        str(p.value),
        str(p.fee_fraction_int),
        cap(p.text),
        p.locked ? 1 : 0,
        p.mime_type ?? null,
        p.status ?? "valid",
        bn ? 1 : null,
        bn?.op ?? null,
        bn?.tick ?? null,
      ),
  );
};
export const broadcasts: Record<string, Handler> = { BROADCAST: broadcast };
