-- Native XCP detail currently recomputes proof-of-burn supply across burns and every destruction/fee table.
-- Store the exact raw-unit value in the existing periodically rebuilt singleton.
ALTER TABLE network_stats_snapshot ADD COLUMN xcp_supply TEXT NOT NULL DEFAULT '0';
