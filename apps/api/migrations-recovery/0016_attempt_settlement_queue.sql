-- Keep recurring attempt reconciliation proportional to live work. Deriving settlement state from
-- every historical input on each two-minute tick made a small attempt table read tens of thousands
-- of rows forever.
ALTER TABLE recovery_attempts ADD COLUMN settlement_pending INTEGER NOT NULL DEFAULT 1
  CHECK(settlement_pending IN (0,1));

-- Existing deeply confirmed attempts were already repaired by the legacy derived-state queue. Keep
-- only genuine leftovers pending so the first post-migration tick can heal them.
UPDATE recovery_attempts SET settlement_pending=0
 WHERE status='confirmed' AND confirmations>=6
   AND NOT EXISTS (
     SELECT 1 FROM recovery_attempt_inputs i
     CROSS JOIN recovery_outputs o
      WHERE i.recovery_txid=recovery_attempts.txid
        AND o.txid=i.input_txid AND o.vout=i.input_vout
        AND o.classification='recoverable'
   );

CREATE INDEX recovery_attempts_work_queue
  ON recovery_attempts(chain_checked_at,reported_at,txid)
  WHERE status<>'confirmed' OR confirmations<6 OR settlement_pending=1;
