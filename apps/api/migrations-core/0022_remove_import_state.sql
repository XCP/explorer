-- The canonical database now follows the Counterparty event stream directly.
-- Remove one-time construction state retained from the initial production load.
DELETE FROM core_state
WHERE key IN (
  'build_complete',
  'import_complete',
  'snapshot_consistent',
  'snapshot_mode',
  'snapshot_expected_tables',
  'seed_event_index',
  'seed_block_index',
  'asset_feed_counts_native_cursor',
  'asset_feed_counts_native_complete',
  'seed_reconciled',
  'reconciled_event_index',
  'parity_verified',
  'forward_write_ready',
  'read_surface_complete',
  'projection_writes_ready'
);
