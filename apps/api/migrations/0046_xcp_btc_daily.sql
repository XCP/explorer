-- Materialize daily XCP/BTC once; the former CTE was re-evaluated for every BTC calendar day.
CREATE TABLE xcp_btc_daily (day TEXT PRIMARY KEY, xcpbtc REAL NOT NULL);
