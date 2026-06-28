-- Bitcoin Stamps classification. Classic Stamps + CP-era SRC-20/721/101 are Counterparty issuances whose
-- `description` carries a `stamp:` payload (base64 image, or base64 JSON with a "p" protocol field). We
-- classify during indexing from the description we already store — no transaction.data needed. Lets us tag
-- which assets are stamps, of which kind, and (for SRC tokens) their tick + op, to segment stamp creators/
-- collectors from Rare Pepe collectors etc. See src/indexer/events/stamp.ts for the classifier.
ALTER TABLE assets ADD COLUMN stamp INTEGER;          -- 1 if this asset is a Bitcoin Stamp
ALTER TABLE assets ADD COLUMN stamp_protocol TEXT;    -- STAMP (classic image) | SRC-20 | SRC-721 | SRC-101
ALTER TABLE assets ADD COLUMN stamp_tick TEXT;        -- SRC token ticker (deploy/mint/transfer target)
ALTER TABLE assets ADD COLUMN stamp_op TEXT;          -- SRC op: deploy | mint | transfer

CREATE INDEX IF NOT EXISTS idx_assets_stamp_protocol ON assets(stamp_protocol);
CREATE INDEX IF NOT EXISTS idx_assets_stamp_tick ON assets(stamp_tick);
