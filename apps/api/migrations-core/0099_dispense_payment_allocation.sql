-- Allocate shared dispenser payments without changing the raw chain records.
ALTER TABLE dispenses ADD COLUMN quote_sats REAL NOT NULL DEFAULT 0;
ALTER TABLE dispenses ADD COLUMN payment_asset_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dispenses ADD COLUMN payment_group INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_dispenses_unaccounted ON dispenses(tx_index) WHERE payment_asset_count=0;
WITH ordered AS (
    SELECT d.event_index,d.tx_index,d.dispense_index,a.asset,d.source_id,d.destination_id,d.btc_amount,
      MAX(0,CASE WHEN p.oracle_address_id IS NULL AND CAST(p.give_quantity AS REAL)>0
        THEN CAST(d.dispense_quantity AS REAL)*CAST(p.satoshirate AS REAL)/CAST(p.give_quantity AS REAL)
        ELSE CAST(d.btc_amount AS REAL) END) notional,
      LAG(a.asset) OVER tx previous_asset,LAG(d.source_id) OVER tx previous_source,
      LAG(d.destination_id) OVER tx previous_destination,LAG(d.btc_amount) OVER tx previous_payment
    FROM dispenses d JOIN asset_dictionary a ON a.asset_id=d.asset_id
    LEFT JOIN dispensers p ON p.tx_index=d.dispenser_tx_index
    WHERE 1=1
    WINDOW tx AS (PARTITION BY d.tx_index ORDER BY d.dispense_index,d.event_index)
  ), grouped AS (
    SELECT *,SUM(CASE WHEN previous_asset IS NULL OR asset<=previous_asset
      OR source_id IS NOT previous_source OR destination_id IS NOT previous_destination
      OR btc_amount IS NOT previous_payment THEN 1 ELSE 0 END)
      OVER(PARTITION BY tx_index ORDER BY dispense_index,event_index ROWS UNBOUNDED PRECEDING) payment_group
    FROM ordered
  ), totals AS (
    SELECT *,SUM(notional) OVER payment total_notional,COUNT(*) OVER payment asset_count
    FROM grouped WINDOW payment AS (PARTITION BY tx_index,payment_group)
  )
  UPDATE dispenses SET quote_sats=CASE WHEN t.total_notional>0
    THEN t.notional*MIN(1.0,MAX(0,CAST(t.btc_amount AS REAL))/t.total_notional) ELSE 0 END,
    payment_asset_count=t.asset_count,payment_group=t.payment_group
  FROM totals t WHERE dispenses.event_index=t.event_index;

-- Correct existing monetary signals immediately; broader ratings are refreshed by maintenance.
WITH corrected AS (
  SELECT d.asset_id,SUM(d.quote_sats)/1e8 btc,MAX(d.quote_sats)/1e8 largest,
    COALESCE(MAX(CASE WHEN d.destination_id<>d.source_id
      AND d.destination_id<>COALESCE(p.origin_id,d.source_id) THEN d.quote_sats END)/1e8,0) clean_largest
  FROM dispenses d LEFT JOIN dispensers p ON p.tx_index=d.dispenser_tx_index GROUP BY d.asset_id
)
UPDATE asset_signals SET dispense_btc=c.btc,max_dispense_btc=c.largest,max_dispense_btc_clean=c.clean_largest
FROM corrected c WHERE asset_signals.asset_id=c.asset_id;
WITH earned AS (
  SELECT COALESCE(p.origin_id,d.source_id) address_id,SUM(d.quote_sats)/1e8 btc,
    COALESCE(SUM(CASE WHEN COALESCE(a.low_quality,0)=0 THEN d.quote_sats END)/1e8,0) clean
  FROM dispenses d LEFT JOIN dispensers p ON p.tx_index=d.dispenser_tx_index
  LEFT JOIN asset_signals a ON a.asset_id=d.asset_id GROUP BY COALESCE(p.origin_id,d.source_id)
)
UPDATE address_signals SET dispense_btc=e.btc,clean_dispense_btc=e.clean
FROM earned e WHERE address_signals.address_id=e.address_id;
WITH spent AS (
  SELECT d.destination_id address_id,SUM(d.quote_sats)/1e8 btc,
    COALESCE(SUM(CASE WHEN COALESCE(a.low_quality,0)=0 THEN d.quote_sats END)/1e8,0) clean
  FROM dispenses d LEFT JOIN asset_signals a ON a.asset_id=d.asset_id GROUP BY d.destination_id
)
UPDATE address_signals SET btc_spent=s.btc,clean_btc_spent=s.clean
FROM spent s WHERE address_signals.address_id=s.address_id;
INSERT INTO asset_signal_dirty(asset_id) SELECT DISTINCT asset_id FROM dispenses WHERE asset_id IS NOT NULL
ON CONFLICT(asset_id) DO NOTHING;
-- Replay derived payments, daily price observations, USD valuations and ratings with the new accounting.
DELETE FROM core_state WHERE key IN ('trades_cur_dispense_payments','prices_synced_blk','usd_cur','pricing_health_day',
  'asset_ratings_refreshed_at','address_reputations_refreshed_at');
DELETE FROM cache;
