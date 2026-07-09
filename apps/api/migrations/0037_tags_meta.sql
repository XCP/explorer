-- Optional JSON sidecar on a tag — structured extra data the categorical fact carries. First use: the
-- tokenscan NFT directory, where a collection membership tag also knows the project's display name and
-- site/domain (meta = {"collection":"Rare Pigeons","site":"https://www.rarepigeons.com/"}). NULL for the
-- vast majority of tags (the tag slug alone is the fact); this only holds the extras worth surfacing.
ALTER TABLE tags ADD COLUMN meta TEXT;
