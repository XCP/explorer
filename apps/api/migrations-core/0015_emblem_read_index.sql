CREATE INDEX idx_emblem_vaults_recent
  ON emblem_vaults(first_seen DESC, token_id DESC);

