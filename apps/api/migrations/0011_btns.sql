-- BTNS (Broadcast Token Naming System) tagging. BTNS encodes token ops in Counterparty BROADCAST text
-- (begins with `btns:`/`bt:`, then `OP|TICK|...`). We TAG which broadcasts are BTNS and their op/tick —
-- we do NOT implement the protocol. "Address is a BTNS user" = any source with a btns=1 broadcast.
-- See src/indexer/events/btns.ts. Classifier runs in the broadcast handler.
ALTER TABLE broadcasts ADD COLUMN btns INTEGER;     -- 1 if this broadcast is a BTNS command
ALTER TABLE broadcasts ADD COLUMN btns_op TEXT;     -- DEPLOY | MINT | TRANSFER | LIST | ...
ALTER TABLE broadcasts ADD COLUMN btns_tick TEXT;   -- token ticker

CREATE INDEX IF NOT EXISTS idx_broadcasts_btns ON broadcasts(btns);
CREATE INDEX IF NOT EXISTS idx_broadcasts_btns_tick ON broadcasts(btns_tick);
