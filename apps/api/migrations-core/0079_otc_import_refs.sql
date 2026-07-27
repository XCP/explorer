-- Persistent staging avoids D1's SQLITE_AUTH rejection of temporary tables in
-- uploaded bulk SQL. The importer empties this table before and after each run.
CREATE TABLE otc_import_refs (ref TEXT PRIMARY KEY) WITHOUT ROWID;
