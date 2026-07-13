-- Recovery reads require a clean full audit of the immutable raw transaction
-- objects. New source pages invalidate the accepted audit before they can be
-- exposed by the read API.
INSERT INTO recovery_state (key, value, updated_at)
VALUES ('r2_audit_ready', '0', unixepoch())
ON CONFLICT(key) DO NOTHING;

INSERT INTO recovery_state (key, value, updated_at)
VALUES ('r2_audit_generation', '0', unixepoch())
ON CONFLICT(key) DO NOTHING;
