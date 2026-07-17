-- One literal 0.0–10.0 asset Rating derived from the validated clean market-depth model.
CREATE TABLE asset_ratings (
  asset_id INTEGER PRIMARY KEY,
  rating REAL NOT NULL,
  rank_position INTEGER NOT NULL,
  population INTEGER NOT NULL,
  active_months_score REAL NOT NULL,
  buyer_breadth_score REAL NOT NULL,
  realized_value_score REAL NOT NULL,
  calculated_at INTEGER NOT NULL,
  model_version INTEGER NOT NULL
);

CREATE INDEX idx_asset_ratings_rating ON asset_ratings(rating DESC,asset_id);

-- Seed the projection in the same migration so readers never observe an installed-but-empty model.
INSERT INTO asset_ratings(
  asset_id,rating,rank_position,population,active_months_score,buyer_breadth_score,
  realized_value_score,calculated_at,model_version
)
WITH components AS MATERIALIZED (
  SELECT signal.asset_id,
    PERCENT_RANK() OVER(ORDER BY signal.clean_active_trade_months) active_months_pct,
    PERCENT_RANK() OVER(ORDER BY signal.distinct_paid_buyers) buyer_breadth_pct,
    PERCENT_RANK() OVER(ORDER BY signal.clean_realized_usd) realized_value_pct
  FROM asset_signals signal
  WHERE COALESCE(signal.low_quality,0)=0
    AND signal.clean_active_trade_months>0 AND signal.distinct_paid_buyers>0
), combined AS MATERIALIZED (
  SELECT asset_id,active_months_pct,buyer_breadth_pct,realized_value_pct,
    (active_months_pct+buyer_breadth_pct+realized_value_pct)/3.0 evidence_rank
  FROM components
), ranked AS (
  SELECT asset_id,
    10.0*PERCENT_RANK() OVER(ORDER BY evidence_rank) rating,
    ROW_NUMBER() OVER(ORDER BY evidence_rank DESC,asset_id) rank_position,
    COUNT(*) OVER() population,
    100.0*active_months_pct active_months_score,
    100.0*buyer_breadth_pct buyer_breadth_score,
    100.0*realized_value_pct realized_value_score
  FROM combined
)
SELECT asset_id,rating,rank_position,population,active_months_score,buyer_breadth_score,
  realized_value_score,unixepoch(),1 FROM ranked;

INSERT INTO core_state(key,value) VALUES('asset_ratings_refreshed_at',unixepoch())
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
