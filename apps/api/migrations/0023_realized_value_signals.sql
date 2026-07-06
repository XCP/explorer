-- Realized-value + clean-dispense asset signals (Scoring Phase B, 2026-07-06). These feed the next
-- reputation re-dial: a USD-denominated realized-value anchor (currency-agnostic, so an Emblem/ETH sale
-- counts the same as a BTC dispense) plus a self-dispense-guarded version of the dispense-value signals —
-- closing the "whale self-dispensing at a high ask" gaming hole flagged in docs/reputation.md (Watch section).
--   max_realized_usd         — largest single trade's usd_value across ALL venues (dex|dispense|emblem)
--   distinct_dispense_buyers — distinct dispense destinations, self-dispenses (source=destination) excluded
--   max_dispense_btc_clean   — largest BTC realized in a NON-self dispense (the clean analog of max_dispense_btc)
--   emblem_trades            — count of Emblem-vault (ETH-side) sales attributed to this asset
-- Populated by the asset_realized_usd / asset_emblem_trades / asset_dispense_buyers feature units (signals.ts);
-- needs a signals refresh. Not scored yet — config.ts weights/anchors are tuned in Phase B part 2.
-- One ALTER per statement (SQLite requirement).
ALTER TABLE asset_signals ADD COLUMN max_realized_usd REAL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN distinct_dispense_buyers INTEGER DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN max_dispense_btc_clean REAL DEFAULT 0;
ALTER TABLE asset_signals ADD COLUMN emblem_trades INTEGER DEFAULT 0;
