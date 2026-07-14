/** ASSET_ISSUANCE / ASSET_TRANSFER / RESET_ISSUANCE — records each issuance row AND keeps the assets
 *  table current. Reissuance mutates the asset (owner/locked/description/mime_type; latest valid wins).
 *  divisibility is NOT touched here (a bare event could carry a falsy value and flip it) — it legally
 *  changes only via a CIP03 reset, applied explicitly below. Supply is recomputed deterministically
 *  (asset enqueued in supplyDirty) — see asset-supply.ts. */
import { type Handler, cap } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { classifyStamp } from "#api/indexer/events/stamp";
import { hashToBytes } from "#api/indexer/identities";
import { issuerCollection, issuerCollectionMeta } from "#api/indexer/issuer-collections";
function assetType(asset: string, longname: unknown): string {
  if (asset === "BTC" || asset === "XCP") return "native";
  if (longname) return "subasset";
  return /^A\d+$/.test(asset) ? "numeric" : "asset";
}
const assetCreation: Handler = ({ p, b }, ctx) => {
  if (!p.asset_name || p.asset_id == null) return;
  const asset = String(p.asset_name);
  ctx.identities.assets.add(asset);
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT INTO assets
           (asset_id,asset_longname,numeric_asset_id,type,first_issuance_block_index,updated_at)
         SELECT asset_id,?,?,?,?,0 FROM asset_dictionary WHERE asset=?
         ON CONFLICT(asset_id) DO UPDATE SET
           asset_longname=excluded.asset_longname,numeric_asset_id=excluded.numeric_asset_id,type=excluded.type,
           first_issuance_block_index=coalesce(assets.first_issuance_block_index,
                                               excluded.first_issuance_block_index)`,
      )
      .bind(p.asset_longname ?? null, String(p.asset_id), assetType(asset, p.asset_longname), b, asset),
  );
};
const issuance: Handler = ({ ev, p, b, bt }, ctx) => {
  if (p.asset) {
    const asset = String(p.asset);
    for (const address of [p.source, p.issuer]) {
      if (address) ctx.identities.addresses.add(String(address));
    }
    ctx.identities.assets.add(asset);
    ctx.stmts.push((db) =>
      db
        .prepare(
          `INSERT INTO issuances
             (event_index,tx_index,tx_hash,msg_index,block_index,block_time,asset_id,asset_longname,quantity,
              quantity_normalized,source_id,issuer_id,transfer,divisible,locked,description,fee_paid,status,
              asset_events,mime_type,reset,callable,call_date,call_price)
           VALUES (?,?,?,?,?,?,
             (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,
             (SELECT address_id FROM address_dictionary WHERE address=?),
             (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(event_index) DO UPDATE SET
             tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,msg_index=excluded.msg_index,
             block_index=excluded.block_index,block_time=excluded.block_time,asset_id=excluded.asset_id,
             asset_longname=excluded.asset_longname,quantity=excluded.quantity,
             quantity_normalized=excluded.quantity_normalized,source_id=excluded.source_id,
             issuer_id=excluded.issuer_id,transfer=excluded.transfer,divisible=excluded.divisible,
             locked=excluded.locked,description=excluded.description,fee_paid=excluded.fee_paid,
             status=excluded.status,asset_events=excluded.asset_events,mime_type=excluded.mime_type,
             reset=excluded.reset,callable=excluded.callable,call_date=excluded.call_date,
             call_price=excluded.call_price`,
        )
        .bind(
          ev.event_index,
          p.tx_index,
          hashToBytes(p.tx_hash),
          p.msg_index ?? 0,
          b,
          bt,
          asset,
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
        ),
    );
  }
  if (p.asset && (p.status ?? "valid") === "valid") {
    ctx.supplyDirty.add(p.asset);
    const type = assetType(p.asset, p.asset_longname);
    const collection = issuerCollection(p.issuer);
    if (collection) {
      {
        ctx.stmts.push(
          (db) =>
            db
              .prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key) VALUES('asset',?)`)
              .bind(p.asset),
          (db) =>
            db
              .prepare(
                `INSERT INTO tags(entity_id,tag,source,meta)
                 SELECT entity_id,?,'issuer',? FROM entity_dictionary
                  WHERE entity_type='asset' AND entity_key=?
                 ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
              )
              .bind(collection.tag, issuerCollectionMeta(collection), p.asset),
        );
      }
    }
    {
      const asset = String(p.asset);
      ctx.stmts.push((db) =>
        db
          .prepare(
            `INSERT INTO assets
               (asset_id,asset_longname,type,issuer_id,owner_id,divisible,locked,description_locked,
                description,mime_type,first_issuance_block_index,last_issuance_block_index,
                first_issuance_block_time,last_issuance_block_time,updated_at)
             SELECT a.asset_id,?,?,i.address_id,i.address_id,?,?,?,?,?,?,?,?,?,0
             FROM asset_dictionary a LEFT JOIN address_dictionary i ON i.address=?
             WHERE a.asset=?
             ON CONFLICT(asset_id) DO UPDATE SET
               asset_longname=coalesce(excluded.asset_longname,assets.asset_longname),
               type=excluded.type,
               issuer_id=coalesce(assets.issuer_id,excluded.issuer_id),
               owner_id=excluded.owner_id,
               divisible=CASE WHEN assets.issuer_id IS NULL THEN excluded.divisible ELSE assets.divisible END,
               locked=max(assets.locked,excluded.locked),
               description_locked=max(assets.description_locked,excluded.description_locked),
               description=coalesce(excluded.description,assets.description),
               mime_type=coalesce(excluded.mime_type,assets.mime_type),
               first_issuance_block_index=coalesce(assets.first_issuance_block_index,
                                                   excluded.first_issuance_block_index),
               last_issuance_block_index=excluded.last_issuance_block_index,
               first_issuance_block_time=coalesce(assets.first_issuance_block_time,
                                                  excluded.first_issuance_block_time),
               last_issuance_block_time=excluded.last_issuance_block_time
             WHERE excluded.last_issuance_block_index >= coalesce(assets.last_issuance_block_index,-1)`,
          )
          .bind(
            p.asset_longname ?? null,
            type,
            p.divisible ? 1 : 0,
            p.locked ? 1 : 0,
            p.description_locked ? 1 : 0,
            cap(p.description),
            p.mime_type ?? null,
            b,
            b,
            bt,
            bt,
            p.issuer ?? null,
            asset,
          ),
      );
      if (p.reset) {
        ctx.stmts.push((db) =>
          db
            .prepare(
              `UPDATE assets SET divisible=?
               WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)`,
            )
            .bind(p.divisible ? 1 : 0, asset),
        );
      }
    }
    // Bitcoin Stamp classification (DERIVED awareness, not a Counterparty field) -> tags, written at ingest with
    // source='protocol' so the computed-tag rebuild never wipes them. SRC-20/721 are meta-protocols layered
    // on Counterparty; we only note that a Counterparty asset is USED for one (categorical) — we don't index the
    // protocol's own token registry (e.g. the SRC-20 tick), which is not Counterparty data.
    const st = classifyStamp(p.description);
    if (st) {
      const tags = [
        "stamp",
        st.protocol === "SRC-20"
          ? "src20"
          : st.protocol === "SRC-721"
            ? "src721"
            : st.protocol === "SRC-101"
              ? "src101"
              : null,
        st.protocol === "SRC-20" && st.op === "deploy" ? "src20_deploy" : null,
      ].filter((tag): tag is string => tag != null);
      {
        ctx.stmts.push((db) =>
          db
            .prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key) VALUES('asset',?)`)
            .bind(String(p.asset)),
        );
        for (const tag of tags)
          ctx.stmts.push((db) =>
            db
              .prepare(
                `INSERT INTO tags(entity_id,tag,source)
                 SELECT entity_id,?,'protocol' FROM entity_dictionary
                 WHERE entity_type='asset' AND entity_key=?
                 ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source`,
              )
              .bind(tag, String(p.asset)),
          );
      }
    }
  }
};
export const issuances: Record<string, Handler> = {
  ASSET_CREATION: assetCreation,
  ASSET_ISSUANCE: issuance,
  ASSET_TRANSFER: issuance,
  RESET_ISSUANCE: issuance,
};
