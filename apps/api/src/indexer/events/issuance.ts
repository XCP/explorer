/** ASSET_ISSUANCE / ASSET_TRANSFER / RESET_ISSUANCE — records each issuance row AND keeps the assets
 *  table current. Reissuance mutates the asset (owner/locked/description/mime_type; latest valid wins).
 *  divisibility is NOT touched here (a bare event could carry a falsy value and flip it) — it legally
 *  changes only via a CIP03 reset, applied explicitly below. Supply is recomputed deterministically
 *  (asset enqueued in supplyDirty) — see asset-supply.ts. */
import { type Handler, cap } from "./context";
import { normalize } from "../codec";
import { classifyStamp } from "./stamp";

const issuance: Handler = ({ ev, p, b, bt }, ctx) => {
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO issuances (event_index,tx_hash,block_index,block_time,asset,asset_longname,quantity,quantity_normalized,source,issuer,transfer,divisible,locked,description,fee_paid,status,asset_events,mime_type,reset,callable,call_date,call_price,msg_index,tx_index)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ev.event_index,
        p.tx_hash ?? null,
        b,
        bt,
        p.asset ?? null,
        p.asset_longname ?? null,
        p.quantity != null ? String(p.quantity) : null,
        p.quantity_normalized ?? normalize(p.quantity, !!p.divisible),
        p.source ?? null,
        p.issuer ?? null,
        p.transfer ? 1 : 0,
        p.divisible ? 1 : 0,
        p.locked ? 1 : 0,
        cap(p.description),
        p.fee_paid != null ? String(p.fee_paid) : null,
        p.status ?? "valid",
        p.asset_events ?? null,
        p.mime_type ?? null,
        p.reset ? 1 : 0,
        p.callable ? 1 : 0,
        p.call_date ?? null,
        p.call_price != null ? String(p.call_price) : null,
        p.msg_index ?? null,
        p.tx_index ?? null,
      ),
  );

  if (p.asset && (p.status ?? "valid") === "valid") {
    ctx.supplyDirty.add(p.asset);
    const type =
      p.asset === "BTC" || p.asset === "XCP"
        ? "native"
        : p.asset_longname
          ? "subasset"
          : p.asset[0] === "A"
            ? "numeric"
            : "asset";
    ctx.stmts.push((db) =>
      db
        .prepare(
          `INSERT INTO assets (asset,asset_longname,type,issuer,owner,divisible,locked,description_locked,supply,supply_normalized,description,mime_type,first_issuance_block_index,last_issuance_block_index,first_issuance_block_time,last_issuance_block_time,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
       ON CONFLICT(asset) DO UPDATE SET owner=excluded.owner, locked=MAX(assets.locked,excluded.locked),
         description_locked=MAX(assets.description_locked,excluded.description_locked),
         description=COALESCE(excluded.description,assets.description), mime_type=COALESCE(excluded.mime_type,assets.mime_type),
         last_issuance_block_index=excluded.last_issuance_block_index, last_issuance_block_time=excluded.last_issuance_block_time
         WHERE excluded.last_issuance_block_index >= assets.last_issuance_block_index`,
        )
        .bind(
          p.asset,
          p.asset_longname ?? null,
          type,
          p.issuer ?? null,
          p.issuer ?? null,
          p.divisible ? 1 : 0,
          p.locked ? 1 : 0,
          p.description_locked ? 1 : 0,
          null,
          null,
          cap(p.description),
          p.mime_type ?? null,
          b,
          b,
          bt,
          bt,
        ),
    );
    // Bitcoin Stamp classification (DERIVED awareness, not a Counterparty field) -> tags, written at ingest with
    // source='protocol' so the computed-tag rebuild never wipes them. SRC-20/721 are meta-protocols layered
    // on Counterparty; we only note that a Counterparty asset is USED for one (categorical) — we don't index the
    // protocol's own token registry (e.g. the SRC-20 tick), which is not Counterparty data.
    const st = classifyStamp(p.description);
    if (st) {
      const tag = (t: string) =>
        ctx.stmts.push((db) =>
          db
            .prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) VALUES ('asset',?,?,'protocol')`)
            .bind(p.asset, t),
        );
      tag("stamp");
      const proto =
        st.protocol === "SRC-20"
          ? "src20"
          : st.protocol === "SRC-721"
            ? "src721"
            : st.protocol === "SRC-101"
              ? "src101"
              : null;
      if (proto) tag(proto);
      if (st.protocol === "SRC-20" && st.op === "deploy") tag("src20_deploy");
    }
    // CIP03 reset is the only legal divisibility mutation — apply it explicitly (chronological replay).
    if (p.reset)
      ctx.stmts.push((db) =>
        db.prepare(`UPDATE assets SET divisible=? WHERE asset=?`).bind(p.divisible ? 1 : 0, p.asset),
      );
  }
};

export const issuances: Record<string, Handler> = {
  ASSET_ISSUANCE: issuance,
  ASSET_TRANSFER: issuance,
  RESET_ISSUANCE: issuance,
};
