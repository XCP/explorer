-- Runtime-only state. Historical cache entries are deliberately not migrated.

CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  ctype TEXT NOT NULL DEFAULT 'application/json',
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_cache_expires ON cache(expires_at);
