BEGIN IMMEDIATE;

INSERT INTO blocks(
  block_index,block_hash,block_time,previous_block_hash,difficulty,ledger_hash,txlist_hash,messages_hash,
  transaction_count
)
SELECT block_index,unhex(block_hash),block_time,unhex(previous_block_hash),difficulty,unhex(ledger_hash),
       unhex(txlist_hash),unhex(messages_hash),transaction_count
FROM source.blocks
WHERE true
ON CONFLICT(block_index) DO UPDATE SET
  block_hash=excluded.block_hash,block_time=excluded.block_time,previous_block_hash=excluded.previous_block_hash,
  difficulty=excluded.difficulty,ledger_hash=excluded.ledger_hash,txlist_hash=excluded.txlist_hash,
  messages_hash=excluded.messages_hash,transaction_count=excluded.transaction_count;

INSERT INTO transactions(
  tx_index,tx_hash,block_index,block_time,source_id,destination_id,btc_amount,fee,supported,utxos_info
)
SELECT t.tx_index,unhex(t.tx_hash),t.block_index,t.block_time,s.address_id,d.address_id,t.btc_amount,t.fee,
       t.supported,t.utxos_info
FROM source.transactions t
LEFT JOIN address_dictionary s ON s.address=t.source
LEFT JOIN address_dictionary d ON d.address=t.destination
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,destination_id=excluded.destination_id,btc_amount=excluded.btc_amount,
  fee=excluded.fee,supported=excluded.supported,utxos_info=excluded.utxos_info;

INSERT INTO assets(
  asset_id,asset_longname,numeric_asset_id,type,issuer_id,owner_id,divisible,locked,description_locked,supply,
  supply_normalized,description,mime_type,first_issuance_block_index,last_issuance_block_index,
  first_issuance_block_time,last_issuance_block_time,updated_at
)
SELECT n.asset_id,a.asset_longname,a.asset_id,a.type,i.address_id,o.address_id,a.divisible,a.locked,
       a.description_locked,a.supply,a.supply_normalized,a.description,a.mime_type,a.first_issuance_block_index,
       a.last_issuance_block_index,a.first_issuance_block_time,a.last_issuance_block_time,a.updated_at
FROM source.assets a
JOIN asset_dictionary n ON n.asset=a.asset
LEFT JOIN address_dictionary i ON i.address=a.issuer
LEFT JOIN address_dictionary o ON o.address=a.owner
WHERE true
ON CONFLICT(asset_id) DO UPDATE SET
  asset_longname=excluded.asset_longname,numeric_asset_id=excluded.numeric_asset_id,type=excluded.type,
  issuer_id=excluded.issuer_id,owner_id=excluded.owner_id,divisible=excluded.divisible,locked=excluded.locked,
  description_locked=excluded.description_locked,supply=excluded.supply,
  supply_normalized=excluded.supply_normalized,description=excluded.description,mime_type=excluded.mime_type,
  first_issuance_block_index=excluded.first_issuance_block_index,
  last_issuance_block_index=excluded.last_issuance_block_index,
  first_issuance_block_time=excluded.first_issuance_block_time,
  last_issuance_block_time=excluded.last_issuance_block_time,updated_at=excluded.updated_at;

INSERT INTO balances(
  address_id,utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,updated_block_index,
  updated_event_index,utxo_address_id
)
SELECT CASE WHEN b.holder_type='address' THEN h.address_id END,
       CASE WHEN b.holder_type='utxo' THEN unhex(substr(b.holder,1,64)) END,
       CASE WHEN b.holder_type='utxo' THEN CAST(substr(b.holder,66) AS INTEGER) END,
       a.asset_id,b.quantity,b.quantity_normalized,b.updated_block_index,b.updated_event_index,u.address_id
FROM source.balances b
JOIN asset_dictionary a ON a.asset=b.asset
LEFT JOIN address_dictionary h ON h.address=b.holder AND b.holder_type='address'
LEFT JOIN address_dictionary u ON u.address=b.utxo_address
WHERE true
ON CONFLICT DO UPDATE SET
  quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
  updated_block_index=excluded.updated_block_index,updated_event_index=excluded.updated_event_index,
  utxo_address_id=excluded.utxo_address_id;

INSERT INTO balance_snapshots(
  address_id,utxo_tx_hash,utxo_vout,asset_id,block_index,quantity,updated_event_index
)
SELECT CASE WHEN is_utxo=0 THEN h.address_id END,
       CASE WHEN is_utxo=1 THEN unhex(substr(x.holder,1,64)) END,
       CASE WHEN is_utxo=1 THEN CAST(substr(x.holder,66) AS INTEGER) END,
       a.asset_id,x.block_index,x.quantity,coalesce(x.updated_event_index,0)
FROM (
  SELECT s.*,
    CASE WHEN instr(s.holder,':')=65 AND length(substr(s.holder,1,64))=64
      AND lower(substr(s.holder,1,64)) NOT GLOB '*[^0-9a-f]*' THEN 1 ELSE 0 END is_utxo
  FROM source.balance_snapshots s
) x
JOIN asset_dictionary a ON a.asset=x.asset
LEFT JOIN address_dictionary h ON h.address=x.holder AND x.is_utxo=0
WHERE true
ON CONFLICT DO UPDATE SET
  quantity=excluded.quantity,updated_event_index=excluded.updated_event_index;

INSERT INTO sends(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,source_address_id,
  destination_address_id,asset_id,quantity,quantity_normalized,memo,memo_hex,send_type,status,fee_paid,msg_index
)
SELECT x.event_index,x.tx_index,unhex(x.tx_hash),x.block_index,x.block_time,s.address_id,d.address_id,
       sa.address_id,da.address_id,a.asset_id,x.quantity,x.quantity_normalized,x.memo,x.memo_hex,x.send_type,
       x.status,x.fee_paid,x.msg_index
FROM source.sends x
LEFT JOIN address_dictionary s ON s.address=x.source
LEFT JOIN address_dictionary d ON d.address=x.destination
LEFT JOIN address_dictionary sa ON sa.address=x.source_address
LEFT JOIN address_dictionary da ON da.address=x.destination_address
LEFT JOIN asset_dictionary a ON a.asset=x.asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,destination_id=excluded.destination_id,
  source_address_id=excluded.source_address_id,destination_address_id=excluded.destination_address_id,
  asset_id=excluded.asset_id,quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
  memo=excluded.memo,memo_hex=excluded.memo_hex,send_type=excluded.send_type,status=excluded.status,
  fee_paid=excluded.fee_paid,msg_index=excluded.msg_index;

INSERT INTO issuances(
  event_index,tx_index,tx_hash,msg_index,block_index,block_time,asset_id,asset_longname,quantity,
  quantity_normalized,source_id,issuer_id,transfer,divisible,locked,description,fee_paid,status,asset_events,
  mime_type,reset,callable,call_date,call_price
)
SELECT x.event_index,x.tx_index,unhex(x.tx_hash),COALESCE(x.msg_index,0),x.block_index,x.block_time,a.asset_id,
       x.asset_longname,x.quantity,x.quantity_normalized,s.address_id,i.address_id,x.transfer,x.divisible,x.locked,
       x.description,x.fee_paid,x.status,x.asset_events,x.mime_type,x.reset,x.callable,x.call_date,x.call_price
FROM source.issuances x
LEFT JOIN asset_dictionary a ON a.asset=x.asset
LEFT JOIN address_dictionary s ON s.address=x.source
LEFT JOIN address_dictionary i ON i.address=x.issuer
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,msg_index=excluded.msg_index,
  block_index=excluded.block_index,block_time=excluded.block_time,asset_id=excluded.asset_id,
  asset_longname=excluded.asset_longname,quantity=excluded.quantity,
  quantity_normalized=excluded.quantity_normalized,source_id=excluded.source_id,issuer_id=excluded.issuer_id,
  transfer=excluded.transfer,divisible=excluded.divisible,locked=excluded.locked,
  description=excluded.description,fee_paid=excluded.fee_paid,status=excluded.status,
  asset_events=excluded.asset_events,mime_type=excluded.mime_type,reset=excluded.reset,
  callable=excluded.callable,call_date=excluded.call_date,call_price=excluded.call_price;

INSERT INTO orders(
  tx_index,tx_hash,block_index,block_time,source_id,give_asset_id,give_quantity,give_remaining,get_asset_id,
  get_quantity,get_remaining,expiration,expire_index,fee_required,fee_required_remaining,fee_provided,
  fee_provided_remaining,status,closed_block_index
)
SELECT t.tx_index,unhex(o.tx_hash),o.block_index,o.block_time,s.address_id,g.asset_id,o.give_quantity,
       o.give_remaining,r.asset_id,o.get_quantity,o.get_remaining,o.expiration,o.expire_index,o.fee_required,
       o.fee_required_remaining,o.fee_provided,o.fee_provided_remaining,o.status,o.closed_block_index
FROM source.orders o
JOIN source.transactions t ON t.tx_hash=o.tx_hash
LEFT JOIN address_dictionary s ON s.address=o.source
LEFT JOIN asset_dictionary g ON g.asset=o.give_asset
LEFT JOIN asset_dictionary r ON r.asset=o.get_asset
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,give_asset_id=excluded.give_asset_id,give_quantity=excluded.give_quantity,
  give_remaining=excluded.give_remaining,get_asset_id=excluded.get_asset_id,get_quantity=excluded.get_quantity,
  get_remaining=excluded.get_remaining,expiration=excluded.expiration,expire_index=excluded.expire_index,
  fee_required=excluded.fee_required,fee_required_remaining=excluded.fee_required_remaining,
  fee_provided=excluded.fee_provided,fee_provided_remaining=excluded.fee_provided_remaining,
  status=excluded.status,closed_block_index=excluded.closed_block_index;

INSERT INTO order_matches(
  tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,forward_asset_id,forward_quantity,
  backward_asset_id,backward_quantity,block_index,block_time,status,match_expire_index,fee_paid,tx0_block_index,
  tx1_block_index,tx0_expiration,tx1_expiration
)
SELECT m.tx0_index,m.tx1_index,unhex(m.tx0_hash),unhex(m.tx1_hash),a0.address_id,a1.address_id,
       f.asset_id,m.forward_quantity,b.asset_id,m.backward_quantity,m.block_index,m.block_time,m.status,
       m.match_expire_index,m.fee_paid,m.tx0_block_index,m.tx1_block_index,m.tx0_expiration,m.tx1_expiration
FROM source.order_matches m
LEFT JOIN address_dictionary a0 ON a0.address=m.tx0_address
LEFT JOIN address_dictionary a1 ON a1.address=m.tx1_address
LEFT JOIN asset_dictionary f ON f.asset=m.forward_asset
LEFT JOIN asset_dictionary b ON b.asset=m.backward_asset
WHERE true
ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET
  tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,tx0_address_id=excluded.tx0_address_id,
  tx1_address_id=excluded.tx1_address_id,forward_asset_id=excluded.forward_asset_id,
  forward_quantity=excluded.forward_quantity,backward_asset_id=excluded.backward_asset_id,
  backward_quantity=excluded.backward_quantity,block_index=excluded.block_index,block_time=excluded.block_time,
  status=excluded.status,match_expire_index=excluded.match_expire_index,fee_paid=excluded.fee_paid,
  tx0_block_index=excluded.tx0_block_index,tx1_block_index=excluded.tx1_block_index,
  tx0_expiration=excluded.tx0_expiration,tx1_expiration=excluded.tx1_expiration;

INSERT INTO core_state(key,value)
SELECT replace(key,'source_','snapshot_'),value FROM source.snapshot_meta
WHERE true
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value)
SELECT 'source_indexer:'||key,value FROM source.indexer_state
WHERE true
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value)
SELECT 'seed_event_index',value FROM source.snapshot_meta WHERE key='source_last_event_index'
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value)
SELECT 'last_event_index',value FROM source.snapshot_meta WHERE key='source_last_event_index'
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value)
SELECT 'seed_block_index',value FROM source.snapshot_meta WHERE key='source_last_block_index'
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value)
SELECT 'last_block_index',value FROM source.snapshot_meta WHERE key='source_last_block_index'
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO core_state(key,value) VALUES
  ('seed_reconciled','0'),
  ('parity_verified','0'),
  ('forward_write_ready','0'),
  ('read_surface_complete','0')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

COMMIT;
