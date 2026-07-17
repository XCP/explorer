-- Canonical asset type lives in assets.type. Mirroring it into generic tags can drift and makes
-- authoritative type predicates slower. `liquid` and `og` also overclaimed what their historical
-- count/age thresholds established; preserve the underlying signals without publishing those labels.
DELETE FROM tags
WHERE source='computed' AND tag IN ('named','subasset','numeric','liquid','og');

UPDATE tags SET tag='low_quality' WHERE source='computed' AND tag='wash';
UPDATE tags SET tag='dex_trader' WHERE source='computed' AND tag='trader';
UPDATE tags SET tag='frequent_dex_trader' WHERE source='computed' AND tag='active_trader';
UPDATE tags SET tag='prolific_collector' WHERE source='computed' AND tag='whale';
