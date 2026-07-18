-- Preserve exactly one prior Rating observation for operational change auditing.
-- This is bounded metadata on the canonical projection, not an unbounded Rating history table.
ALTER TABLE asset_ratings ADD COLUMN previous_rating REAL;
ALTER TABLE asset_ratings ADD COLUMN previous_calculated_at INTEGER;

