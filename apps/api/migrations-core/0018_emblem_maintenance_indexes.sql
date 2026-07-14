CREATE INDEX idx_emblem_vaults_unresolved ON emblem_vaults(resolved,token_id) WHERE resolved=0;
CREATE INDEX idx_emblem_vaults_meta_queue ON emblem_vaults(meta_crawled,vault_kind,token_id) WHERE meta_crawled=0;
