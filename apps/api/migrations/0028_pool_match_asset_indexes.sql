-- Per-asset AMM swap feed (GET /v2/assets/:asset/pool-matches): pool_matches filtered by the asset on
-- either leg of the swap. The existing indexes cover block / lp_asset / pair only, so give each leg its
-- own recent-first index (same shape as idx_pm_lp / idx_pm_pair).
CREATE INDEX IF NOT EXISTS idx_pm_fwd ON pool_matches(forward_asset, block_index DESC);
CREATE INDEX IF NOT EXISTS idx_pm_bwd ON pool_matches(backward_asset, block_index DESC);
