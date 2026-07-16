-- Address reputation covers Bitcoin addresses. UTXO balance locations and Ethereum vault identities remain in the
-- polymorphic dictionary, but their historical derived signal rows are outside this projection's domain.
DELETE FROM address_signals
WHERE address_id IN (
  SELECT address_id FROM address_dictionary
  WHERE NOT (address GLOB '1*' OR address GLOB '3*' OR lower(address) LIKE 'bc1%')
);
