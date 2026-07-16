-- Preserve each independent collection-membership assertion. `tags` remains the
-- compact canonical read projection selected deterministically from this table.
CREATE TABLE collection_membership_evidence (
  entity_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','issuer','discovered','collection','digirare','tokenscan')),
  value REAL,
  meta TEXT,
  observed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(entity_id, tag, source)
) WITHOUT ROWID;

CREATE INDEX idx_collection_membership_evidence_tag
  ON collection_membership_evidence(tag, entity_id);

-- The old projection retained only one source per membership. Preserve that
-- evidence now; replayable writers can add independently corroborating sources.
INSERT INTO collection_membership_evidence(entity_id,tag,source,value,meta)
SELECT entity_id,tag,source,value,meta FROM tags
WHERE source IN ('manual','issuer','discovered','collection','digirare','tokenscan');
