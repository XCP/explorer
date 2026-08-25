-- A reported recovery that never reached the network held its inputs hostage forever. The read path
-- withholds an output on attempt membership alone, and `transaction-not-seen-inputs-unspent` is not a
-- terminal status, so four July 2026 attempts hid 196 outputs (0.0133 BTC) from their owners with no
-- transaction on chain to justify it. An abandoned attempt consumed nothing and must say so.
ALTER TABLE recovery_attempts ADD COLUMN inputs_released INTEGER NOT NULL DEFAULT 0
  CHECK(inputs_released IN (0,1));

-- The queue predicate could never exclude an abandoned attempt: every disjunct still matched a failed
-- row (`status<>'confirmed'` and `confirmations<6` are both true of one). `settlement_pending` already
-- means "this attempt still owes reconciliation work", so make it the whole predicate rather than one
-- clause of three. Every row the old index selected, this one selects too — a deeply confirmed attempt
-- whose outputs are settled is the only thing either form excludes today.
DROP INDEX recovery_attempts_work_queue;
CREATE INDEX recovery_attempts_work_queue
  ON recovery_attempts(chain_checked_at,reported_at,txid)
  WHERE settlement_pending=1;
