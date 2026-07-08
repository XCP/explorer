-- Emblem vault contents + crack classification, and the per-sale scam verdict it drives.
-- All DERIVED (rebuildable from the raw mirror: sends/balances) — the Counterparty mirror stays pure
-- (CLAUDE.md rule 7). An Emblem vault is a BTC address wrapping a Counterparty card; a "sale" on
-- Ethereum is only real if the card was still IN the vault at sale time. These columns let us tell a
-- real sale (vault full) from a scam (vault empty at creation, or CRACKED — the card sent back out —
-- before the sale) and attribute the actual asset + quantity, not a hardcoded 1.

-- emblem_vaults: intrinsic per-vault facts, populated by src/indexer/vault-contents.ts.
ALTER TABLE emblem_vaults ADD COLUMN contents_asset  TEXT;     -- the single wrapped card (NULL if multi/foreign)
ALTER TABLE emblem_vaults ADD COLUMN contents_qty    REAL;     -- its NORMALIZED units ever funded (kills the qty=1 hardcode; fixes multi-unit)
ALTER TABLE emblem_vaults ADD COLUMN vault_kind      TEXT;     -- 'single' | 'multi' (bundle) | 'foreign' (no Counterparty asset — value on another chain, NOT a scam)
ALTER TABLE emblem_vaults ADD COLUMN funded          INTEGER DEFAULT 0;  -- ever received a Counterparty (non-XCP) asset (1/0)
ALTER TABLE emblem_vaults ADD COLUMN cracked_at      INTEGER;  -- block_time of the FIRST outbound crack (send OR sweep; NULL = never cracked)
ALTER TABLE emblem_vaults ADD COLUMN cracker_address TEXT;     -- BTC destination of that first crack — the value-puller (bad-actor candidate)
ALTER TABLE emblem_vaults ADD COLUMN classified      INTEGER DEFAULT 0;  -- 0 = needs a vault-contents pass

-- trades: the per-sale verdict on the DERIVED ledger (not the raw mirror). Only 'real' sales carry an
-- attributed asset; the rest are recorded but excluded from per-asset realized value.
ALTER TABLE trades ADD COLUMN sale_class TEXT;  -- 'real' | 'scam_cracked' | 'bundle' | 'non_counterparty' (emblem only; NULL for on-chain venues)

-- address_signals: bad-actor count — vaults this BTC address CRACKED that were then sold empty.
ALTER TABLE address_signals ADD COLUMN vault_scams INTEGER DEFAULT 0;
