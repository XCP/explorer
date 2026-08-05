-- The reclassify sweep (RECOVERY_RECLASSIFY_QUEUE_SQL) runs every cron tick and filters on
-- classifier_version, which had no index — a caught-up queue still scanned all ~800k output rows to
-- return nothing (~550M billed D1 reads/day). With the version leading this index the empty case is
-- a zero-width range scan, and a real backlog pages in txid order exactly as the sweep consumes it.
CREATE INDEX recovery_outputs_classifier ON recovery_outputs (classifier_version, txid);
