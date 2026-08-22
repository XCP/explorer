-- Only asset issuers and current owners can serve an asset-detail count.
-- Other address rows remain null until their normal bounded refresh runs.
UPDATE address_signals AS signal
SET assets_controlled = (
  SELECT count(*) FROM assets
  WHERE issuer_id=signal.address_id OR owner_id=signal.address_id
)
WHERE signal.address_id IN (
  SELECT issuer_id FROM assets WHERE issuer_id IS NOT NULL
  UNION
  SELECT owner_id FROM assets WHERE owner_id IS NOT NULL
);
