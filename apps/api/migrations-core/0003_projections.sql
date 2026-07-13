-- Explorer-owned projections and external enrichments. High-cardinality entity keys use the canonical
-- dictionaries too; the compact database does not reintroduce repeated address/asset strings above the mirror.

CREATE TABLE entity_dictionary (
  entity_id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  UNIQUE(entity_type, entity_key)
);

CREATE TABLE address_signals (
  address_id INTEGER PRIMARY KEY,
  first_block INTEGER,
  last_block INTEGER NOT NULL DEFAULT 0,
  out_peers INTEGER NOT NULL DEFAULT 0,
  in_peers INTEGER NOT NULL DEFAULT 0,
  dispense_btc REAL NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0,
  dividends INTEGER NOT NULL DEFAULT 0,
  assets_issued INTEGER NOT NULL DEFAULT 0,
  locked_assets INTEGER NOT NULL DEFAULT 0,
  btc_spent REAL NOT NULL DEFAULT 0,
  btc_fees REAL NOT NULL DEFAULT 0,
  assets_held INTEGER NOT NULL DEFAULT 0,
  assets_received INTEGER NOT NULL DEFAULT 0,
  survived_assets INTEGER NOT NULL DEFAULT 0,
  assets_distributed INTEGER NOT NULL DEFAULT 0,
  assets_hits INTEGER NOT NULL DEFAULT 0,
  rep_score REAL NOT NULL DEFAULT 1,
  clean_dispense_btc REAL NOT NULL DEFAULT 0,
  clean_btc_spent REAL NOT NULL DEFAULT 0,
  is_exchange INTEGER NOT NULL DEFAULT 0,
  is_deposit INTEGER NOT NULL DEFAULT 0,
  is_burn INTEGER NOT NULL DEFAULT 0,
  assets_burned INTEGER NOT NULL DEFAULT 0,
  disp_trust REAL NOT NULL DEFAULT 0,
  is_emblem_vault INTEGER NOT NULL DEFAULT 0,
  likely_service INTEGER NOT NULL DEFAULT 0,
  dex_trades INTEGER NOT NULL DEFAULT 0,
  stamps_created INTEGER NOT NULL DEFAULT 0,
  stamps_collected INTEGER NOT NULL DEFAULT 0,
  src20_deploys INTEGER NOT NULL DEFAULT 0,
  is_btns_user INTEGER NOT NULL DEFAULT 0,
  graph_trust REAL NOT NULL DEFAULT 0,
  graph_distrust REAL NOT NULL DEFAULT 0,
  vault_scams INTEGER NOT NULL DEFAULT 0,
  shell_scams INTEGER NOT NULL DEFAULT 0,
  dump_scams INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_address_signals_score ON address_signals(rep_score DESC);
CREATE INDEX idx_address_signals_activity ON address_signals(last_block DESC);

CREATE TABLE asset_signals (
  asset_id INTEGER PRIMARY KEY,
  issuer_id INTEGER,
  divisible INTEGER,
  locked INTEGER,
  holders INTEGER NOT NULL DEFAULT 0,
  top1_pct REAL NOT NULL DEFAULT 0,
  trades INTEGER NOT NULL DEFAULT 0,
  self_trade_pct REAL NOT NULL DEFAULT 0,
  first_trade_blk INTEGER NOT NULL DEFAULT 0,
  last_trade_blk INTEGER NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0,
  dispense_btc REAL NOT NULL DEFAULT 0,
  low_quality INTEGER NOT NULL DEFAULT 0,
  holder_breadth REAL NOT NULL DEFAULT 0,
  pct_creator_holders REAL NOT NULL DEFAULT 0,
  burned_pct REAL NOT NULL DEFAULT 0,
  distinct_traders INTEGER NOT NULL DEFAULT 0,
  distinct_dispensers INTEGER NOT NULL DEFAULT 0,
  age_blocks INTEGER NOT NULL DEFAULT 0,
  avg_holder_dex REAL NOT NULL DEFAULT 0,
  recent_events INTEGER NOT NULL DEFAULT 0,
  recency_blocks INTEGER NOT NULL DEFAULT 0,
  max_dispense_btc REAL NOT NULL DEFAULT 0,
  max_trade_xcp REAL NOT NULL DEFAULT 0,
  supply REAL NOT NULL DEFAULT 0,
  max_realized_usd REAL NOT NULL DEFAULT 0,
  distinct_dispense_buyers INTEGER NOT NULL DEFAULT 0,
  max_dispense_btc_clean REAL NOT NULL DEFAULT 0,
  emblem_trades INTEGER NOT NULL DEFAULT 0,
  graph_trust REAL NOT NULL DEFAULT 0,
  graph_distrust REAL NOT NULL DEFAULT 0,
  holder_cohesion REAL,
  cohesion_edges INTEGER,
  cohesion_strong INTEGER
);
CREATE INDEX idx_asset_signals_quality ON asset_signals(low_quality, max_realized_usd DESC);
CREATE INDEX idx_asset_signals_issuer ON asset_signals(issuer_id);

CREATE TABLE asset_feed_counts (
  asset_id INTEGER PRIMARY KEY,
  sales INTEGER NOT NULL DEFAULT 0,
  issuances INTEGER NOT NULL DEFAULT 0,
  dispensers INTEGER NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 0,
  fairmints INTEGER NOT NULL DEFAULT 0,
  dividends INTEGER NOT NULL DEFAULT 0,
  destructions INTEGER NOT NULL DEFAULT 0,
  pools INTEGER NOT NULL DEFAULT 0,
  subassets INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE btc_signals (
  address_id INTEGER PRIMARY KEY,
  btc_received REAL NOT NULL DEFAULT 0,
  btc_sent REAL NOT NULL DEFAULT 0,
  btc_balance REAL NOT NULL DEFAULT 0,
  btc_txs INTEGER NOT NULL DEFAULT 0,
  btc_first_block INTEGER,
  btc_last_block INTEGER,
  updated_at INTEGER
);

CREATE TABLE tags (
  entity_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'computed',
  value REAL,
  meta TEXT,
  PRIMARY KEY(entity_id, tag)
);
CREATE INDEX idx_tags_tag_entity ON tags(tag, entity_id);
CREATE INDEX idx_tags_source ON tags(source, entity_id);

CREATE TABLE graph_edges (
  source_id INTEGER NOT NULL,
  destination_id INTEGER NOT NULL,
  weight REAL NOT NULL,
  edge_block INTEGER,
  UNIQUE(source_id, destination_id)
);
CREATE INDEX idx_graph_edges_destination ON graph_edges(destination_id, source_id);

CREATE TABLE graph_node (
  address_id INTEGER PRIMARY KEY,
  outsum REAL NOT NULL DEFAULT 0,
  insum REAL NOT NULL DEFAULT 0
);

CREATE TABLE graph_rank (
  address_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  rank REAL NOT NULL DEFAULT 0,
  normalized_rank REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(address_id, slot)
);

CREATE TABLE graph_seed (
  address_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY(address_id, slot)
);

CREATE TABLE graph_inflow (
  address_id INTEGER PRIMARY KEY,
  value REAL NOT NULL
);

CREATE TABLE graph_baseline (
  entity_id INTEGER PRIMARY KEY,
  trust REAL,
  distrust REAL
);

CREATE TABLE pr_edges (
  source_id INTEGER NOT NULL,
  destination_id INTEGER NOT NULL,
  multiplicity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(source_id, destination_id)
);
CREATE INDEX idx_pr_edges_destination ON pr_edges(destination_id);

CREATE TABLE trades (
  venue TEXT NOT NULL,
  ref TEXT NOT NULL,
  asset_id INTEGER,
  block_time INTEGER,
  block_index INTEGER,
  quantity REAL,
  currency TEXT,
  total REAL,
  price REAL GENERATED ALWAYS AS (CASE WHEN quantity > 0 THEN total / quantity END) VIRTUAL,
  usd_value REAL,
  buyer_id INTEGER,
  seller_id INTEGER,
  tx_hash BLOB,
  external_tx_hash TEXT,
  sale_class TEXT,
  PRIMARY KEY(venue, ref),
  CHECK (tx_hash IS NULL OR external_tx_hash IS NULL)
);
CREATE INDEX idx_trades_asset_time ON trades(asset_id, block_time DESC);
CREATE INDEX idx_trades_buyer_time ON trades(buyer_id, block_time DESC);
CREATE INDEX idx_trades_seller_time ON trades(seller_id, block_time DESC);
CREATE INDEX idx_trades_venue_time ON trades(venue, block_time DESC);

CREATE TABLE prices (
  day TEXT NOT NULL,
  currency TEXT NOT NULL,
  usd REAL,
  source TEXT NOT NULL DEFAULT 'derived',
  PRIMARY KEY(day, currency)
);

CREATE TABLE xcp_btc_daily (
  day TEXT PRIMARY KEY,
  xcpbtc REAL NOT NULL
);

CREATE TABLE network_stats_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  assets INTEGER NOT NULL DEFAULT 0,
  transactions INTEGER NOT NULL DEFAULT 0,
  balances INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 0,
  issuances INTEGER NOT NULL DEFAULT 0,
  dispensers INTEGER NOT NULL DEFAULT 0,
  dispenses INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  order_matches INTEGER NOT NULL DEFAULT 0,
  sweeps INTEGER NOT NULL DEFAULT 0,
  broadcasts INTEGER NOT NULL DEFAULT 0,
  dividends INTEGER NOT NULL DEFAULT 0,
  fairmints INTEGER NOT NULL DEFAULT 0,
  destructions INTEGER NOT NULL DEFAULT 0,
  holders INTEGER NOT NULL DEFAULT 0,
  btc_fees REAL NOT NULL DEFAULT 0,
  xcp_destroyed REAL NOT NULL DEFAULT 0,
  xcp_supply TEXT NOT NULL DEFAULT '0',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE curated (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  note TEXT,
  PRIMARY KEY(kind, key)
);

CREATE TABLE exchange_top_assets (
  generation INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  depositors INTEGER NOT NULL,
  PRIMARY KEY(generation, asset_id)
) WITHOUT ROWID;

CREATE TABLE emblem_vaults (
  token_id TEXT PRIMARY KEY,
  contract_id INTEGER,
  btc_address_id INTEGER,
  resolved INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER,
  contents_asset_id INTEGER,
  contents_qty REAL,
  vault_kind TEXT,
  funded INTEGER NOT NULL DEFAULT 0,
  cracked_at INTEGER,
  cracker_address_id INTEGER,
  classified INTEGER NOT NULL DEFAULT 0,
  claimed_name TEXT,
  claimed_asset_id INTEGER,
  content_coins TEXT,
  has_contents INTEGER,
  emblem_fraud INTEGER,
  meta_crawled INTEGER NOT NULL DEFAULT 0,
  is_scam_shell INTEGER NOT NULL DEFAULT 0,
  is_dump INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_emblem_vaults_btc_address ON emblem_vaults(btc_address_id);
CREATE INDEX idx_emblem_vaults_asset ON emblem_vaults(contents_asset_id);

CREATE TABLE emblem_sales (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  contract_id INTEGER,
  token_id TEXT,
  price_raw TEXT,
  token_address_id INTEGER,
  marketplace TEXT,
  buyer_id INTEGER,
  seller_id INTEGER,
  block_number INTEGER,
  PRIMARY KEY(tx_hash, log_index)
);
CREATE INDEX idx_emblem_sales_token ON emblem_sales(contract_id, token_id, block_number DESC);

CREATE TABLE emblem_listings (
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  asset_id INTEGER,
  order_id TEXT,
  marketplace TEXT,
  price_usd REAL,
  price_amount TEXT,
  currency_id INTEGER,
  url TEXT,
  expiry INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(contract_id, token_id)
);
CREATE INDEX idx_emblem_listings_asset ON emblem_listings(asset_id, price_usd);

CREATE TABLE emblem_scam_sellers (
  seller_id INTEGER PRIMARY KEY,
  scams INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE scarce_city_sales (
  asset_id INTEGER NOT NULL,
  sold_at INTEGER NOT NULL,
  price_btc REAL NOT NULL,
  PRIMARY KEY(asset_id, sold_at)
);
