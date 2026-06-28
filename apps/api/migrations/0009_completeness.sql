-- Completeness pass: capture every event field the indexer was dropping, found by auditing each
-- counterparty-core message source (lib/messages/*.py) against applyEvent(). All additive (ADD COLUMN /
-- new tables) so it's safe to apply to a live DB; historical rows backfill on the next full re-index.

-- balances: the controlling Bitcoin address of a utxo-attached balance (CP CREDIT/DEBIT carry utxo_address).
ALTER TABLE balances ADD COLUMN utxo_address TEXT;

-- sends / attach / detach / move: utxo<->address provenance, the XCP attach gas fee, and CP's per-tx indices.
ALTER TABLE sends ADD COLUMN source_address TEXT;
ALTER TABLE sends ADD COLUMN destination_address TEXT;
ALTER TABLE sends ADD COLUMN fee_paid TEXT;
ALTER TABLE sends ADD COLUMN memo_hex TEXT;
ALTER TABLE sends ADD COLUMN msg_index INTEGER;
ALTER TABLE sends ADD COLUMN tx_index INTEGER;

-- issuances: per-issuance content type, the reset flag, legacy CFD call params, and CP indices.
ALTER TABLE issuances ADD COLUMN mime_type TEXT;
ALTER TABLE issuances ADD COLUMN reset INTEGER;
ALTER TABLE issuances ADD COLUMN callable INTEGER;
ALTER TABLE issuances ADD COLUMN call_date INTEGER;
ALTER TABLE issuances ADD COLUMN call_price TEXT;
ALTER TABLE issuances ADD COLUMN msg_index INTEGER;
ALTER TABLE issuances ADD COLUMN tx_index INTEGER;

-- orders: the running BTC-order fee budget (decremented on match, restored on match expiration).
ALTER TABLE orders ADD COLUMN fee_required_remaining TEXT;
ALTER TABLE orders ADD COLUMN fee_provided_remaining TEXT;

-- order_matches: BTC-match expiry driver + deducted fee + per-leg tx/block/expiration context.
ALTER TABLE order_matches ADD COLUMN match_expire_index INTEGER;
ALTER TABLE order_matches ADD COLUMN fee_paid TEXT;
ALTER TABLE order_matches ADD COLUMN tx0_index INTEGER;
ALTER TABLE order_matches ADD COLUMN tx1_index INTEGER;
ALTER TABLE order_matches ADD COLUMN tx0_block_index INTEGER;
ALTER TABLE order_matches ADD COLUMN tx1_block_index INTEGER;
ALTER TABLE order_matches ADD COLUMN tx0_expiration INTEGER;
ALTER TABLE order_matches ADD COLUMN tx1_expiration INTEGER;

-- dispensers: the true creator (origin differs from source for empty-address dispensers) + scheduled close.
ALTER TABLE dispensers ADD COLUMN origin TEXT;
ALTER TABLE dispensers ADD COLUMN last_status_tx_hash TEXT;

-- dispenser refills: their own history (amount, refiller, dispenser) — was being dropped entirely.
CREATE TABLE IF NOT EXISTS dispenser_refills (
  event_index INTEGER PRIMARY KEY,
  tx_hash TEXT, block_index INTEGER, block_time INTEGER,
  source TEXT, destination TEXT, asset TEXT,
  dispense_quantity TEXT, dispenser_tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_refill_dispenser ON dispenser_refills(dispenser_tx_hash);

-- pool liquidity / matches: LP burned on withdraw + swap fee detail + match status + routing order.
ALTER TABLE pool_liquidity ADD COLUMN quantity_destroyed TEXT;
ALTER TABLE pool_matches ADD COLUMN fee_quantity TEXT;
ALTER TABLE pool_matches ADD COLUMN fee_bps INTEGER;
ALTER TABLE pool_matches ADD COLUMN order_tx_hash TEXT;
ALTER TABLE pool_matches ADD COLUMN status TEXT;

-- fairminters: the full mint-economics config (price ratio, premint, commission, per-address cap, etc.).
ALTER TABLE fairminters ADD COLUMN quantity_by_price TEXT;
ALTER TABLE fairminters ADD COLUMN premint_quantity TEXT;
ALTER TABLE fairminters ADD COLUMN pre_minted INTEGER;
ALTER TABLE fairminters ADD COLUMN minted_asset_commission_int TEXT;
ALTER TABLE fairminters ADD COLUMN max_mint_per_address TEXT;
ALTER TABLE fairminters ADD COLUMN burn_payment INTEGER;
ALTER TABLE fairminters ADD COLUMN lock_description INTEGER;
ALTER TABLE fairminters ADD COLUMN lock_quantity INTEGER;
ALTER TABLE fairminters ADD COLUMN description TEXT;
ALTER TABLE fairminters ADD COLUMN mime_type TEXT;
ALTER TABLE fairminters ADD COLUMN asset_parent TEXT;

-- bet_matches: bull/bear attribution, settlement fee, and expiry driver.
ALTER TABLE bet_matches ADD COLUMN tx0_bet_type INTEGER;
ALTER TABLE bet_matches ADD COLUMN tx1_bet_type INTEGER;
ALTER TABLE bet_matches ADD COLUMN fee_fraction_int TEXT;
ALTER TABLE bet_matches ADD COLUMN match_expire_index INTEGER;

-- cancels: cancel transactions as first-class rows (who cancelled which offer).
CREATE TABLE IF NOT EXISTS cancels (
  tx_hash TEXT PRIMARY KEY,
  block_index INTEGER, block_time INTEGER,
  source TEXT, offer_hash TEXT, status TEXT
);
CREATE INDEX IF NOT EXISTS idx_cancels_offer ON cancels(offer_hash);

-- bet match resolutions: who won / settled / dropped, with the bet-match type.
CREATE TABLE IF NOT EXISTS bet_match_resolutions (
  event_index INTEGER PRIMARY KEY,
  tx_hash TEXT, block_index INTEGER, block_time INTEGER,
  bet_match_id TEXT, bet_match_type_id INTEGER,
  winner TEXT, settled INTEGER,
  bull_credit TEXT, bear_credit TEXT, escrow_less_fee TEXT, fee TEXT, status TEXT
);
CREATE INDEX IF NOT EXISTS idx_betres_match ON bet_match_resolutions(bet_match_id);

-- index utxo_address so a utxo-attached balance can be rolled up to its controlling address.
CREATE INDEX IF NOT EXISTS idx_bal_utxo_addr ON balances(utxo_address);
