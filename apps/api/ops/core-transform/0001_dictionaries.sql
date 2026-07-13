BEGIN IMMEDIATE;

INSERT INTO asset_dictionary(asset)
SELECT asset FROM (
  SELECT asset FROM source.assets
  UNION SELECT asset FROM source.balances
  UNION SELECT asset FROM source.balance_snapshots
  UNION SELECT asset FROM source.sends
  UNION SELECT asset FROM source.issuances
  UNION SELECT give_asset FROM source.orders
  UNION SELECT get_asset FROM source.orders
  UNION SELECT forward_asset FROM source.order_matches
  UNION SELECT backward_asset FROM source.order_matches
  UNION SELECT asset FROM source.destructions
  UNION SELECT asset FROM source.dividends
  UNION SELECT dividend_asset FROM source.dividends
  UNION SELECT asset FROM source.dispensers
  UNION SELECT asset FROM source.dispenses
  UNION SELECT asset FROM source.dispenser_refills
  UNION SELECT asset FROM source.fairminters
  UNION SELECT asset_parent FROM source.fairminters
  UNION SELECT asset FROM source.fairmints
  UNION SELECT asset_a FROM source.pools
  UNION SELECT asset_b FROM source.pools
  UNION SELECT forward_asset FROM source.pool_matches
  UNION SELECT backward_asset FROM source.pool_matches
  UNION SELECT asset_a FROM source.pool_liquidity
  UNION SELECT asset_b FROM source.pool_liquidity
  UNION SELECT asset FROM source.asset_signals
  UNION SELECT asset FROM source.asset_feed_counts
  UNION SELECT asset FROM source.exchange_top_assets
  UNION SELECT asset FROM source.trades
  UNION SELECT contents_asset FROM source.emblem_vaults
  UNION SELECT claimed_asset FROM source.emblem_vaults
  UNION SELECT asset FROM source.emblem_listings
  UNION SELECT asset FROM source.scarce_city_sales
) WHERE asset IS NOT NULL
ON CONFLICT(asset) DO NOTHING;

INSERT INTO address_dictionary(address)
SELECT address FROM (
  SELECT source address FROM source.transactions UNION SELECT destination FROM source.transactions
  UNION SELECT CASE WHEN holder_type='address' THEN holder END FROM source.balances
  UNION SELECT utxo_address FROM source.balances
  UNION SELECT CASE
    WHEN instr(holder,':')=65 AND length(substr(holder,1,64))=64
      AND lower(substr(holder,1,64)) NOT GLOB '*[^0-9a-f]*' THEN NULL
    ELSE holder
  END FROM source.balance_snapshots
  UNION SELECT source FROM source.sends UNION SELECT destination FROM source.sends
  UNION SELECT source_address FROM source.sends UNION SELECT destination_address FROM source.sends
  UNION SELECT source FROM source.issuances UNION SELECT issuer FROM source.issuances
  UNION SELECT source FROM source.orders
  UNION SELECT tx0_address FROM source.order_matches UNION SELECT tx1_address FROM source.order_matches
  UNION SELECT source FROM source.sweeps UNION SELECT destination FROM source.sweeps
  UNION SELECT source FROM source.destructions UNION SELECT source FROM source.burns
  UNION SELECT source FROM source.dividends UNION SELECT source FROM source.broadcasts
  UNION SELECT source FROM source.cancels
  UNION SELECT source FROM source.btcpays UNION SELECT destination FROM source.btcpays
  UNION SELECT source FROM source.bets UNION SELECT feed_address FROM source.bets
  UNION SELECT tx0_address FROM source.bet_matches UNION SELECT tx1_address FROM source.bet_matches
  UNION SELECT feed_address FROM source.bet_matches UNION SELECT winner FROM source.bet_match_resolutions
  UNION SELECT source FROM source.rps
  UNION SELECT tx0_address FROM source.rps_matches UNION SELECT tx1_address FROM source.rps_matches
  UNION SELECT source FROM source.dispensers UNION SELECT oracle_address FROM source.dispensers
  UNION SELECT origin FROM source.dispensers
  UNION SELECT source FROM source.dispenses UNION SELECT destination FROM source.dispenses
  UNION SELECT source FROM source.dispenser_refills UNION SELECT destination FROM source.dispenser_refills
  UNION SELECT source FROM source.fairminters UNION SELECT source FROM source.fairmints
  UNION SELECT source FROM source.pool_matches UNION SELECT source FROM source.pool_liquidity
  UNION SELECT address FROM source.credits UNION SELECT utxo_address FROM source.credits
  UNION SELECT address FROM source.debits UNION SELECT utxo_address FROM source.debits
  UNION SELECT address FROM source.address_signals UNION SELECT issuer FROM source.asset_signals
  UNION SELECT addr FROM source.btc_signals
  UNION SELECT src FROM source.graph_edges UNION SELECT dst FROM source.graph_edges
  UNION SELECT id FROM source.graph_node UNION SELECT node FROM source.graph_rank
  UNION SELECT node FROM source.graph_seed UNION SELECT node FROM source.graph_inflow
  UNION SELECT s FROM source.pr_edges UNION SELECT d FROM source.pr_edges
  UNION SELECT buyer FROM source.trades UNION SELECT seller FROM source.trades
  UNION SELECT contract FROM source.emblem_vaults UNION SELECT btc_address FROM source.emblem_vaults
  UNION SELECT cracker_address FROM source.emblem_vaults
  UNION SELECT contract FROM source.emblem_sales UNION SELECT token_addr FROM source.emblem_sales
  UNION SELECT buyer FROM source.emblem_sales UNION SELECT seller FROM source.emblem_sales
  UNION SELECT contract FROM source.emblem_listings UNION SELECT currency FROM source.emblem_listings
  UNION SELECT seller FROM source.emblem_scam_sellers
) WHERE address IS NOT NULL
ON CONFLICT(address) DO NOTHING;

INSERT INTO entity_dictionary(entity_type,entity_key)
SELECT entity_type,entity_id FROM source.tags WHERE true
UNION
SELECT CASE kind WHEN 'addr' THEN 'address' ELSE kind END,id FROM source.graph_baseline WHERE true
ON CONFLICT(entity_type,entity_key) DO NOTHING;

COMMIT;
