-- The public reputation overview is refreshed weekly, but its histogram was
-- grouping the full scored population on every cache regeneration. Keep the
-- 101 possible display bins as one rebuildable JSON projection instead.
CREATE TABLE address_reputation_histogram (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  bins TEXT NOT NULL CHECK(json_valid(bins))
);

INSERT INTO address_reputation_histogram(singleton,bins)
SELECT 1,json_group_array(json_object('bin',bin,'count',count))
FROM (
  SELECT MIN(100,CAST(reputation AS INTEGER)) bin,COUNT(*) count
  FROM address_reputations
  GROUP BY MIN(100,CAST(reputation AS INTEGER))
  ORDER BY bin
);
