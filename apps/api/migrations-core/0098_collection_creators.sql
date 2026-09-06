-- Who created the cards in each curated collection: the source of every
-- member asset's first valid issuance, one row per (creator, collection).
-- A read projection for badging a page of addresses in one indexed lookup,
-- instead of walking the collection tables per address. Rebuilt after every
-- collections crawl (indexer/collection-creators.ts).
CREATE TABLE collection_creators (
  address_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  cards INTEGER NOT NULL,
  PRIMARY KEY(address_id, tag)
) WITHOUT ROWID;
