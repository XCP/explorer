-- Emblem high-supply single-unit DUMPS. Selling ONE fungible unit of a very-high-supply card as a
-- "collectible" NFT: PEPECASH's unit is worth $0.008, GUARDSPEPE's $0.0004, PEPEONECOIN never traded at all —
-- yet single units sell on Emblem for ~$40 (thousands-to-∞× markup), and the repeat operators do it hundreds
-- of times. Predatory, not a real sale. The vault FUNDER (who deposited the unit to dump it) is the bad
-- actor's on-chain identity. is_dump flags such vaults; address_signals.dump_scams counts them per funder
-- (count-scaled negative factor, and a graph-distrust seed like shell_scams/vault_scams).
ALTER TABLE emblem_vaults  ADD COLUMN is_dump    INTEGER DEFAULT 0;
ALTER TABLE address_signals ADD COLUMN dump_scams INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ev_dump ON emblem_vaults(is_dump) WHERE is_dump=1;
