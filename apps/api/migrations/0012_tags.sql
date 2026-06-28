-- Polymorphic tags — the unified categorical layer for addresses AND assets. Replaces scattered is_*
-- booleans + read-time archetypes + the ad-hoc "labeled set" with ONE queryable table. Numeric detail
-- (trades=200) stays in the signal tables; tags hold the categorical facts ("is a trader/vault/grail").
-- source: 'computed' (derived from signals, rebuilt) | 'curated' (from code lists) | 'manual' (hand-set).
CREATE TABLE IF NOT EXISTS tags (
  entity_type TEXT NOT NULL,   -- 'address' | 'asset'
  entity_id   TEXT NOT NULL,   -- the address string or asset name
  tag         TEXT NOT NULL,   -- exchange|vault|trader|og|creator|grail|wash|stamp|src20|...
  source      TEXT NOT NULL DEFAULT 'computed',
  value       REAL,            -- optional (confidence / snapshot magnitude); usually NULL
  PRIMARY KEY (entity_type, entity_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag, entity_type);
CREATE INDEX IF NOT EXISTS idx_tags_entity ON tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tags_source ON tags(source);
