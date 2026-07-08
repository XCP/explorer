-- Emblem vault METADATA enrichment — what the vault CLAIMS vs. what it actually HOLDS. Sourced from
-- Emblem's own /meta API (v2.emblemvault.io/meta/{token_id}) — the same endpoint emblem.ts already uses
-- to resolve the BTC address; we just capture the name/values/fraud fields we discarded the first time.
-- Purpose: split the 'foreign' bucket (on-chain empty to us) into genuinely-foreign vaults (value on
-- another chain — Namecoin/Ordinals/BTC) vs. empty Counterparty SCAMS (name claims a real CP card, but
-- the address never held it and nothing is inside). All DERIVED — rebuildable by re-crawling /meta.
ALTER TABLE emblem_vaults ADD COLUMN claimed_name  TEXT;    -- leading token of the vault's Emblem name, uppercased (e.g. 'PEPECASH')
ALTER TABLE emblem_vaults ADD COLUMN claimed_asset TEXT;    -- claimed_name resolved to a REAL Counterparty asset (NULL if it isn't one)
ALTER TABLE emblem_vaults ADD COLUMN content_coins TEXT;    -- comma-list of coin types actually inside (Emblem /meta values: 'ordinalsbtc,btc'); NULL/'' = nothing
ALTER TABLE emblem_vaults ADD COLUMN has_contents  INTEGER; -- 1 if Emblem reports any non-zero holding (any chain)
ALTER TABLE emblem_vaults ADD COLUMN emblem_fraud  INTEGER; -- Emblem's own fraud flag (captured for display; not a gate)
ALTER TABLE emblem_vaults ADD COLUMN meta_crawled  INTEGER DEFAULT 0; -- 0 = /meta not yet captured
