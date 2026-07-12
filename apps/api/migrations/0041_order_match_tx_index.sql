-- The tx page's order view shows the order's MATCHES below it (the dispenser-sales pattern: the tape
-- under the offer). A match references its two maker orders by tx0_hash/tx1_hash; both sides need an
-- index or every order page pays a full order_matches scan (~260k rows).
CREATE INDEX IF NOT EXISTS idx_om_tx0 ON order_matches(tx0_hash);
CREATE INDEX IF NOT EXISTS idx_om_tx1 ON order_matches(tx1_hash);
