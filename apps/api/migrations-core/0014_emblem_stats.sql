CREATE TABLE emblem_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  vaults INTEGER NOT NULL,
  funded INTEGER NOT NULL,
  cracked_to_user INTEGER NOT NULL,
  revaulted INTEGER NOT NULL,
  depositors INTEGER NOT NULL,
  all_holders INTEGER NOT NULL,
  real_users INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

