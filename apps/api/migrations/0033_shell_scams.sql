-- Emblem empty-shell SCAM attribution → reputation. A 'scam_empty' vault claims a real Counterparty card
-- in its name but holds nothing (indexer/emblem-meta.ts). The seller who minted it is an ETH address, out
-- of our BTC scoring domain — BUT if that same seller also self-funded REAL vaults, the BTC address that
-- consistently funded them is their on-chain identity (the creator bridge; src/indexer/emblem-scam.ts).
-- We attribute the genuine-shell count to that BTC address and dock reputation, count-scaled (a dedicated
-- scammer is hit hard; a prolific creator with one stray gets a nudge their real work outweighs).

-- COLLISION FILTER: only count a shell whose claimed card is ACTUALLY wrapped by ≥1 real vault. Without this
-- ~half of scam_empty were false positives — Ordinals vaults ("Bitcoin Punk", "TwelveFold", "Inscription #…")
-- whose leading name word coincidentally matches a Counterparty asset (BITCOIN/ORDINAL/TWELVEFOLD all had 0
-- real wrappers). This flag is the genuine-shell verdict; it also cleans the public trades.sale_class count.
ALTER TABLE emblem_vaults ADD COLUMN is_scam_shell INTEGER DEFAULT 0;

-- Bad-actor signal on the BTC identity: count of genuine empty shells attributable to it via the bridge.
ALTER TABLE address_signals ADD COLUMN shell_scams INTEGER DEFAULT 0;

-- Derived scratch: the ETH sellers who minted genuine shells + how many (rebuilt by the attribution builder).
CREATE TABLE IF NOT EXISTS emblem_scam_sellers (seller TEXT PRIMARY KEY, scams INTEGER);

-- Indexes: the collision filter checks claimed_asset ∈ {real vaults' contents}; the seller rollup scans by flag.
CREATE INDEX IF NOT EXISTS idx_ev_contents ON emblem_vaults(contents_asset);
CREATE INDEX IF NOT EXISTS idx_ev_scam_shell ON emblem_vaults(is_scam_shell) WHERE is_scam_shell=1;
