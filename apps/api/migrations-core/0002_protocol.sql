-- Remaining canonical Counterparty relations. Repeated public strings are dictionary references; hashes use
-- their 32-byte representation; public composite ids are reconstructed at the API boundary.

CREATE TABLE ledger_events (
  event_index INTEGER PRIMARY KEY,
  direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
  block_index INTEGER NOT NULL,
  tx_hash BLOB,
  address_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  quantity TEXT NOT NULL,
  calling_function TEXT,
  utxo_address_id INTEGER
);
CREATE INDEX idx_ledger_address_page ON ledger_events(address_id, block_index DESC, event_index DESC);
CREATE INDEX idx_ledger_asset_address ON ledger_events(asset_id, address_id);
CREATE INDEX idx_ledger_block ON ledger_events(block_index, event_index);

CREATE TABLE sweeps (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  destination_id INTEGER,
  flags INTEGER,
  memo TEXT,
  fee_paid TEXT,
  status TEXT
);
CREATE INDEX idx_sweeps_block ON sweeps(block_index, tx_index);
CREATE INDEX idx_sweeps_source ON sweeps(source_id, block_index DESC);
CREATE INDEX idx_sweeps_destination ON sweeps(destination_id, block_index DESC);

CREATE TABLE destructions (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  asset_id INTEGER,
  quantity TEXT,
  quantity_normalized TEXT,
  tag TEXT,
  status TEXT
);
CREATE INDEX idx_destructions_tx ON destructions(tx_index);
CREATE INDEX idx_destructions_block ON destructions(block_index, event_index);
CREATE INDEX idx_destructions_source ON destructions(source_id, block_index DESC, event_index DESC);
CREATE INDEX idx_destructions_asset ON destructions(asset_id, block_index DESC, event_index DESC);

CREATE TABLE burns (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  burned TEXT,
  burned_normalized TEXT,
  earned TEXT,
  earned_normalized TEXT,
  status TEXT
);
CREATE INDEX idx_burns_block ON burns(block_index, tx_index);
CREATE INDEX idx_burns_source ON burns(source_id, block_index DESC);

CREATE TABLE dividends (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  asset_id INTEGER,
  dividend_asset_id INTEGER,
  quantity_per_unit TEXT,
  quantity_per_unit_normalized TEXT,
  fee_paid TEXT,
  status TEXT
);
CREATE INDEX idx_dividends_block ON dividends(block_index, tx_index);
CREATE INDEX idx_dividends_source ON dividends(source_id, block_index DESC);
CREATE INDEX idx_dividends_asset ON dividends(asset_id, block_index DESC);

CREATE TABLE broadcasts (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  timestamp INTEGER,
  value TEXT,
  fee_fraction_int TEXT,
  text TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  status TEXT,
  btns INTEGER,
  btns_op TEXT,
  btns_tick TEXT
);
CREATE INDEX idx_broadcasts_block ON broadcasts(block_index, tx_index);
CREATE INDEX idx_broadcasts_source ON broadcasts(source_id, block_index DESC);

CREATE TABLE cancels (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  offer_tx_index INTEGER,
  status TEXT
);
CREATE INDEX idx_cancels_block ON cancels(block_index, tx_index);
CREATE INDEX idx_cancels_source ON cancels(source_id, block_index DESC);
CREATE INDEX idx_cancels_offer ON cancels(offer_tx_index);

CREATE TABLE btcpays (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL UNIQUE,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  destination_id INTEGER,
  order_match_tx0_index INTEGER NOT NULL,
  order_match_tx1_index INTEGER NOT NULL,
  btc_amount TEXT,
  btc_amount_normalized TEXT,
  status TEXT
);
CREATE INDEX idx_btcpays_block ON btcpays(block_index, event_index);
CREATE INDEX idx_btcpays_source ON btcpays(source_id, block_index DESC);
CREATE INDEX idx_btcpays_destination ON btcpays(destination_id, block_index DESC);
CREATE INDEX idx_btcpays_match ON btcpays(order_match_tx0_index, order_match_tx1_index);

CREATE TABLE bets (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  feed_address_id INTEGER,
  bet_type INTEGER,
  deadline INTEGER,
  wager_quantity TEXT,
  wager_remaining TEXT,
  counterwager_quantity TEXT,
  counterwager_remaining TEXT,
  target_value TEXT,
  leverage INTEGER,
  expiration INTEGER,
  expire_index INTEGER,
  fee_fraction_int TEXT,
  status TEXT
);
CREATE INDEX idx_bets_block ON bets(block_index, tx_index);
CREATE INDEX idx_bets_source ON bets(source_id, block_index DESC);
CREATE INDEX idx_bets_feed ON bets(feed_address_id, block_index DESC);

CREATE TABLE bet_matches (
  tx0_index INTEGER NOT NULL,
  tx1_index INTEGER NOT NULL,
  tx0_hash BLOB NOT NULL,
  tx1_hash BLOB NOT NULL,
  tx0_address_id INTEGER,
  tx1_address_id INTEGER,
  feed_address_id INTEGER,
  forward_quantity TEXT,
  backward_quantity TEXT,
  deadline INTEGER,
  target_value TEXT,
  leverage INTEGER,
  initial_value TEXT,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  status TEXT,
  tx0_bet_type INTEGER,
  tx1_bet_type INTEGER,
  fee_fraction_int TEXT,
  match_expire_index INTEGER,
  PRIMARY KEY(tx0_index, tx1_index)
);
CREATE INDEX idx_bet_matches_block ON bet_matches(block_index, tx0_index, tx1_index);
CREATE INDEX idx_bet_matches_tx0_address ON bet_matches(tx0_address_id, block_index DESC);
CREATE INDEX idx_bet_matches_tx1_address ON bet_matches(tx1_address_id, block_index DESC);
CREATE INDEX idx_bet_matches_feed ON bet_matches(feed_address_id, block_index DESC);

CREATE TABLE bet_match_resolutions (
  event_index INTEGER PRIMARY KEY,
  tx_hash BLOB,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  bet_match_tx0_index INTEGER NOT NULL,
  bet_match_tx1_index INTEGER NOT NULL,
  bet_match_type_id INTEGER,
  winner_id INTEGER,
  settled INTEGER,
  bull_credit TEXT,
  bear_credit TEXT,
  escrow_less_fee TEXT,
  fee TEXT,
  status TEXT
);
CREATE INDEX idx_bet_resolutions_block ON bet_match_resolutions(block_index, event_index);
CREATE INDEX idx_bet_resolutions_match ON bet_match_resolutions(bet_match_tx0_index, bet_match_tx1_index);
CREATE INDEX idx_bet_resolutions_winner ON bet_match_resolutions(winner_id, block_index DESC);

CREATE TABLE rps (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  possible_moves INTEGER,
  wager TEXT,
  move_random_hash BLOB,
  expiration INTEGER,
  expire_index INTEGER,
  status TEXT
);
CREATE INDEX idx_rps_block ON rps(block_index, tx_index);
CREATE INDEX idx_rps_source ON rps(source_id, block_index DESC);

CREATE TABLE rps_matches (
  tx0_index INTEGER NOT NULL,
  tx1_index INTEGER NOT NULL,
  tx0_hash BLOB NOT NULL,
  tx1_hash BLOB NOT NULL,
  tx0_address_id INTEGER,
  tx1_address_id INTEGER,
  possible_moves INTEGER,
  wager TEXT,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  status TEXT,
  PRIMARY KEY(tx0_index, tx1_index)
);
CREATE INDEX idx_rps_matches_block ON rps_matches(block_index, tx0_index, tx1_index);
CREATE INDEX idx_rps_matches_tx0_address ON rps_matches(tx0_address_id, block_index DESC);
CREATE INDEX idx_rps_matches_tx1_address ON rps_matches(tx1_address_id, block_index DESC);

CREATE TABLE dispensers (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  give_quantity TEXT,
  give_quantity_normalized TEXT,
  escrow_quantity TEXT,
  give_remaining TEXT,
  give_remaining_normalized TEXT,
  satoshirate TEXT,
  satoshirate_normalized TEXT,
  status INTEGER,
  oracle_address_id INTEGER,
  dispense_count INTEGER NOT NULL DEFAULT 0,
  closed_block_index INTEGER,
  origin_id INTEGER,
  last_status_tx_hash BLOB
);
CREATE INDEX idx_dispensers_block ON dispensers(block_index, tx_index);
CREATE INDEX idx_dispensers_source ON dispensers(source_id, block_index DESC);
CREATE INDEX idx_dispensers_origin ON dispensers(origin_id, block_index DESC);
CREATE INDEX idx_dispensers_asset_status ON dispensers(asset_id, status);

CREATE TABLE dispenses (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  dispense_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  dispenser_tx_index INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  destination_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  dispense_quantity TEXT,
  dispense_quantity_normalized TEXT,
  btc_amount TEXT,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  UNIQUE(tx_index, dispense_index, source_id, destination_id)
);
CREATE INDEX idx_dispenses_tx ON dispenses(tx_index, dispense_index);
CREATE INDEX idx_dispenses_block ON dispenses(block_index, event_index);
CREATE INDEX idx_dispenses_dispenser ON dispenses(dispenser_tx_index, block_index DESC);
CREATE INDEX idx_dispenses_source ON dispenses(source_id, block_index DESC);
CREATE INDEX idx_dispenses_destination ON dispenses(destination_id, block_index DESC);
CREATE INDEX idx_dispenses_asset ON dispenses(asset_id, block_index DESC);

CREATE TABLE dispenser_refills (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL,
  tx_hash BLOB NOT NULL,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER NOT NULL,
  destination_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  dispense_quantity TEXT,
  dispenser_tx_index INTEGER NOT NULL,
  UNIQUE(tx_index, source_id, destination_id)
);
CREATE INDEX idx_dispenser_refills_block ON dispenser_refills(block_index, event_index);
CREATE INDEX idx_dispenser_refills_dispenser ON dispenser_refills(dispenser_tx_index, block_index DESC);
CREATE INDEX idx_dispenser_refills_source ON dispenser_refills(source_id, block_index DESC);

CREATE TABLE fairminters (
  tx_index INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  asset_id INTEGER,
  asset_parent_id INTEGER,
  asset_longname TEXT,
  description TEXT,
  price TEXT,
  quantity_by_price TEXT,
  hard_cap TEXT,
  burn_payment INTEGER,
  max_mint_per_tx TEXT,
  premint_quantity TEXT,
  start_block INTEGER,
  end_block INTEGER,
  minted_asset_commission_int TEXT,
  soft_cap TEXT,
  soft_cap_deadline_block INTEGER,
  lock_description INTEGER,
  lock_quantity INTEGER,
  divisible INTEGER NOT NULL DEFAULT 0,
  pre_minted INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  max_mint_per_address TEXT,
  mime_type TEXT,
  earned_quantity TEXT,
  paid_quantity TEXT,
  pool_quantity TEXT,
  lp_asset TEXT
);
CREATE INDEX idx_fairminters_block ON fairminters(block_index, tx_index);
CREATE INDEX idx_fairminters_source ON fairminters(source_id, block_index DESC);
CREATE INDEX idx_fairminters_asset ON fairminters(asset_id, status);
CREATE INDEX idx_fairminters_parent ON fairminters(asset_parent_id);

CREATE TABLE fairmints (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL UNIQUE,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  fairminter_tx_index INTEGER,
  asset_id INTEGER,
  earn_quantity TEXT,
  paid_quantity TEXT,
  commission TEXT,
  status TEXT
);
CREATE INDEX idx_fairmints_block ON fairmints(block_index, event_index);
CREATE INDEX idx_fairmints_source ON fairmints(source_id, block_index DESC);
CREATE INDEX idx_fairmints_asset ON fairmints(asset_id, block_index DESC);
CREATE INDEX idx_fairmints_fairminter ON fairmints(fairminter_tx_index, block_index DESC);

CREATE TABLE pools (
  asset_a_id INTEGER NOT NULL,
  asset_b_id INTEGER NOT NULL,
  lp_asset TEXT NOT NULL UNIQUE,
  pair TEXT,
  reserve_a TEXT,
  reserve_b TEXT,
  lp_supply TEXT,
  price REAL,
  status TEXT,
  block_index INTEGER NOT NULL,
  updated_block_index INTEGER,
  PRIMARY KEY(asset_a_id, asset_b_id)
);
CREATE INDEX idx_pools_asset_b ON pools(asset_b_id, asset_a_id);
CREATE INDEX idx_pools_block ON pools(updated_block_index DESC);

CREATE TABLE pool_matches (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL UNIQUE,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  lp_asset TEXT,
  pair TEXT,
  forward_asset_id INTEGER,
  forward_quantity TEXT,
  backward_asset_id INTEGER,
  backward_quantity TEXT,
  fee_quantity TEXT,
  fee_bps INTEGER,
  order_tx_index INTEGER,
  status TEXT
);
CREATE INDEX idx_pool_matches_block ON pool_matches(block_index, event_index);
CREATE INDEX idx_pool_matches_source ON pool_matches(source_id, block_index DESC);
CREATE INDEX idx_pool_matches_forward_asset ON pool_matches(forward_asset_id, block_index DESC);
CREATE INDEX idx_pool_matches_backward_asset ON pool_matches(backward_asset_id, block_index DESC);

CREATE TABLE pool_liquidity (
  event_index INTEGER PRIMARY KEY,
  tx_index INTEGER NOT NULL UNIQUE,
  tx_hash BLOB NOT NULL UNIQUE,
  block_index INTEGER NOT NULL,
  block_time INTEGER,
  source_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  asset_a_id INTEGER,
  asset_b_id INTEGER,
  quantity_a TEXT,
  quantity_b TEXT,
  quantity_minted TEXT,
  quantity_destroyed TEXT,
  status TEXT
);
CREATE INDEX idx_pool_liquidity_block ON pool_liquidity(block_index, event_index);
CREATE INDEX idx_pool_liquidity_source ON pool_liquidity(source_id, block_index DESC);
CREATE INDEX idx_pool_liquidity_assets ON pool_liquidity(asset_a_id, asset_b_id, block_index DESC);
