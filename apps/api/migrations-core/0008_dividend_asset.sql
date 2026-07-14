-- Asset activity includes dividends paid in the asset as well as dividends paid on it.
CREATE INDEX idx_dividends_dividend_asset
  ON dividends(dividend_asset_id, block_index DESC);
