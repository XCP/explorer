/** Canonical full rebuild for the singleton network-stat read model. */
export const NETWORK_STATS_REBUILD_SQL = `UPDATE network_stats_snapshot SET
  assets=(SELECT COUNT(*) FROM assets), transactions=(SELECT COUNT(*) FROM transactions),
  balances=(SELECT COUNT(*) FROM balances), sends=(SELECT COUNT(*) FROM sends),
  issuances=(SELECT COUNT(*) FROM issuances), dispensers=(SELECT COUNT(*) FROM dispensers),
  dispenses=(SELECT COUNT(*) FROM dispenses), orders=(SELECT COUNT(*) FROM orders),
  order_matches=(SELECT COUNT(*) FROM order_matches), sweeps=(SELECT COUNT(*) FROM sweeps),
  broadcasts=(SELECT COUNT(*) FROM broadcasts), dividends=(SELECT COUNT(*) FROM dividends),
  fairmints=(SELECT COUNT(*) FROM fairmints), destructions=(SELECT COUNT(*) FROM destructions),
  holders=(SELECT COUNT(*) FROM balances WHERE CAST(quantity AS INTEGER)>0),
  btc_fees=(SELECT COALESCE(SUM(CAST(fee AS REAL)),0)/100000000.0 FROM transactions),
  xcp_destroyed=(SELECT COALESCE(SUM(CAST(amt AS REAL)),0)/100000000.0 FROM (
    SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
    UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
    UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL
    UNION ALL SELECT quantity FROM destructions WHERE asset='XCP' AND status LIKE 'valid%'
  )),
  xcp_supply=CAST(
    (SELECT COALESCE(SUM(CAST(earned AS INTEGER)),0) FROM burns)
    - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset='XCP' AND status LIKE 'valid%')
    - (SELECT COALESCE(SUM(CAST(amt AS INTEGER)),0) FROM (
        SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
        UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
        UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL
      )) AS TEXT),
  updated_at=unixepoch() WHERE singleton=1`;

export const CORE_NETWORK_STATS_REBUILD_SQL = `UPDATE network_stats_snapshot SET
  assets=(SELECT COUNT(*) FROM assets), transactions=(SELECT COUNT(*) FROM transactions),
  balances=(SELECT COUNT(*) FROM balances), sends=(SELECT COUNT(*) FROM sends),
  issuances=(SELECT COUNT(*) FROM issuances), dispensers=(SELECT COUNT(*) FROM dispensers),
  dispenses=(SELECT COUNT(*) FROM dispenses), orders=(SELECT COUNT(*) FROM orders),
  order_matches=(SELECT COUNT(*) FROM order_matches), sweeps=(SELECT COUNT(*) FROM sweeps),
  broadcasts=(SELECT COUNT(*) FROM broadcasts), dividends=(SELECT COUNT(*) FROM dividends),
  fairmints=(SELECT COUNT(*) FROM fairmints), destructions=(SELECT COUNT(*) FROM destructions),
  holders=(SELECT COUNT(*) FROM balances WHERE CAST(quantity AS INTEGER)>0),
  btc_fees=(SELECT COALESCE(SUM(CAST(fee AS REAL)),0)/100000000.0 FROM transactions),
  xcp_destroyed=(SELECT COALESCE(SUM(CAST(amt AS REAL)),0)/100000000.0 FROM (
    SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
    UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
    UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL
    UNION ALL SELECT destruction.quantity FROM destructions destruction
      WHERE destruction.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
        AND destruction.status LIKE 'valid%'
  )),
  xcp_supply=CAST(
    (SELECT COALESCE(SUM(CAST(earned AS INTEGER)),0) FROM burns)
    - (SELECT COALESCE(SUM(CAST(destruction.quantity AS INTEGER)),0) FROM destructions destruction
        WHERE destruction.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
          AND destruction.status LIKE 'valid%')
    - (SELECT COALESCE(SUM(CAST(amt AS INTEGER)),0) FROM (
        SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
        UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
        UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL
      )) AS TEXT),
  updated_at=unixepoch() WHERE singleton=1`;
