-- Move Bitcoin Stamp classification OFF the raw `assets` table into a dedicated DERIVED table.
-- Rationale (architecture Layer 1 vs 2): `assets` is the boring 1:1 Counterparty mirror — only native CP
-- fields. Stamp/SRC-20 classification is DERIVED awareness (parsed from the issuance description), and the
-- SRC-20/721 meta-protocols are NOT Counterparty — we only note that a CP asset is *used* for them. So the
-- classification lives in its own derived table, which the `tags` layer projects from (parallel to how
-- asset_signals -> behavioral tags). Backfill from the existing assets.stamp* columns; 0014 drops them.
CREATE TABLE IF NOT EXISTS asset_stamps (
  asset    TEXT PRIMARY KEY,   -- the Counterparty asset (numeric/named) that carries the stamp payload
  protocol TEXT,               -- STAMP (classic image) | SRC-20 | SRC-721 | SRC-101
  tick     TEXT,               -- SRC token ticker (meta-protocol detail; awareness only)
  op       TEXT                -- SRC op: deploy | mint | transfer
);
CREATE INDEX IF NOT EXISTS idx_asset_stamps_protocol ON asset_stamps(protocol);

INSERT OR IGNORE INTO asset_stamps (asset, protocol, tick, op)
  SELECT asset, stamp_protocol, stamp_tick, stamp_op FROM assets WHERE stamp=1;
