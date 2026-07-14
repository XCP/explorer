/** ASSET_ISSUANCE / ASSET_TRANSFER / RESET_ISSUANCE — records each issuance row AND keeps the assets
 *  table current. Reissuance mutates the asset (owner/locked/description/mime_type; latest valid wins).
 *  divisibility is NOT touched here (a bare event could carry a falsy value and flip it) — it legally
 *  changes only via a CIP03 reset, applied explicitly below. Supply is recomputed deterministically
 *  (asset enqueued in supplyDirty) — see asset-supply.ts. */
import { type Handler, cap } from "#api/indexer/events/context";
import { normalize } from "#api/indexer/codec";
import { classifyStamp } from "#api/indexer/events/stamp";
import { hashToBytes } from "#api/indexer/compact-codec";
import { issuerCollection, issuerCollectionMeta } from "#api/indexer/issuer-collections";

function assetType(asset: string, longname: unknown): string {
  if (asset === "BTC" || asset === "XCP") return "native";
  if (longname) return "subasset";
  return /^A\d+$/.test(asset) ? "numeric" : "asset";
}

const assetCreation: Handler = ({ p, b }, ctx) => {
  if (!ctx.compact || !p.asset_name || p.asset_id == null) return;
  const asset = String(p.asset_name);
  ctx.compact.identities.assets.add(asset);
  ctx.compact.stmts.push((db) =>
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

  if (ctx.compact && p.asset) {
    const asset = String(p.asset);
    for (const address of [p.source, p.issuer]) {
      if (address) ctx.compact.identities.addresses.add(String(address));
    }
    ctx.compact.identities.assets.add(asset);
    ctx.compact.stmts.push((db) =>
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
    const collection = issuerCollection(p.issuer);
    if (collection) {
      ctx.stmts.push((db) =>
        db
          .prepare(
            `INSERT INTO tags(entity_type,entity_id,tag,source,meta) VALUES('asset',?,?,'issuer',?)
             ON CONFLICT(entity_type,entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
          )
          .bind(p.asset, collection.tag, issuerCollectionMeta(collection)),
      );
      if (ctx.compact) {
        ctx.compact.stmts.push(
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
    if (ctx.compact) {
      const asset = String(p.asset);
      ctx.compact.stmts.push((db) =>
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
        ctx.compact.stmts.push((db) =>
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
  ASSET_CREATION: assetCreation,
  ASSET_ISSUANCE: issuance,
  ASSET_TRANSFER: issuance,
  RESET_ISSUANCE: issuance,
};
