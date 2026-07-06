-- Balance bug fix (2026-06-28): reorg rollback restored balance.quantity from a snapshot but never reset
-- balance.updated_event_index, so the post-reorg replay's re-applied credits were SKIPPED by the idempotency
-- high-water (sync.ts applyBalances line ~100) — freezing balances mid-sequence → negative balances (worst on
-- XCP, the highest-churn asset near tip). Fix: snapshots carry the event-index high-water so rollback restores
-- it, letting the replay re-apply correctly. (Also: a full re-index now wipes balances — see sync.ts — because
-- the high-water otherwise makes replay a no-op on existing balances, which is why past rebuilds never healed.)
ALTER TABLE balance_snapshots ADD COLUMN updated_event_index INTEGER DEFAULT 0;
