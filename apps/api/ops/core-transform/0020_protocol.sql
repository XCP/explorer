BEGIN IMMEDIATE;

INSERT INTO ledger_events(
  event_index,direction,block_index,tx_hash,address_id,asset_id,quantity,calling_function,utxo_address_id
)
SELECT e.event_index,e.direction,e.block_index,unhex(e.tx_hash),a.address_id,s.asset_id,e.quantity,
       e.calling_function,u.address_id
FROM (
  SELECT event_index,1 direction,block_index,tx_hash,address,asset,quantity,calling_function,utxo_address
  FROM source.credits
  UNION ALL
  SELECT event_index,0,block_index,tx_hash,address,asset,quantity,calling_function,utxo_address
  FROM source.debits
) e
JOIN address_dictionary a ON a.address=e.address
JOIN asset_dictionary s ON s.asset=e.asset
LEFT JOIN address_dictionary u ON u.address=e.utxo_address
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  direction=excluded.direction,block_index=excluded.block_index,tx_hash=excluded.tx_hash,
  address_id=excluded.address_id,asset_id=excluded.asset_id,quantity=excluded.quantity,
  calling_function=excluded.calling_function,utxo_address_id=excluded.utxo_address_id;

INSERT INTO sweeps(
  tx_index,tx_hash,block_index,block_time,source_id,destination_id,flags,memo,fee_paid,status
)
SELECT t.tx_index,unhex(s.tx_hash),s.block_index,s.block_time,a.address_id,d.address_id,s.flags,s.memo,
       s.fee_paid,s.status
FROM source.sweeps s
JOIN source.transactions t ON t.tx_hash=s.tx_hash
LEFT JOIN address_dictionary a ON a.address=s.source
LEFT JOIN address_dictionary d ON d.address=s.destination
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,destination_id=excluded.destination_id,flags=excluded.flags,
  memo=excluded.memo,fee_paid=excluded.fee_paid,status=excluded.status;

INSERT INTO destructions(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,asset_id,quantity,quantity_normalized,tag,status
)
SELECT d.event_index,t.tx_index,unhex(d.tx_hash),d.block_index,d.block_time,a.address_id,s.asset_id,d.quantity,
       d.quantity_normalized,d.tag,d.status
FROM source.destructions d
JOIN source.transactions t ON t.tx_hash=d.tx_hash
LEFT JOIN address_dictionary a ON a.address=d.source
LEFT JOIN asset_dictionary s ON s.asset=d.asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,asset_id=excluded.asset_id,
  quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
  tag=excluded.tag,status=excluded.status;

INSERT INTO burns(
  tx_index,tx_hash,block_index,block_time,source_id,burned,burned_normalized,earned,earned_normalized,status
)
SELECT COALESCE(t.tx_index,0),unhex(b.tx_hash),b.block_index,b.block_time,a.address_id,b.burned,b.burned_normalized,
       b.earned,b.earned_normalized,b.status
FROM source.burns b
LEFT JOIN source.transactions t ON t.tx_hash=b.tx_hash
LEFT JOIN address_dictionary a ON a.address=b.source
WHERE t.tx_index IS NOT NULL OR b.tx_hash='685623401c3f5e9d2eaaf0657a50454e56a270ee7630d409e98d3bc257560098'
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,burned=excluded.burned,burned_normalized=excluded.burned_normalized,
  earned=excluded.earned,earned_normalized=excluded.earned_normalized,status=excluded.status;

INSERT INTO dividends(
  tx_index,tx_hash,block_index,block_time,source_id,asset_id,dividend_asset_id,quantity_per_unit,
  quantity_per_unit_normalized,fee_paid,status
)
SELECT t.tx_index,unhex(d.tx_hash),d.block_index,d.block_time,a.address_id,s.asset_id,p.asset_id,
       d.quantity_per_unit,d.quantity_per_unit_normalized,d.fee_paid,d.status
FROM source.dividends d
JOIN source.transactions t ON t.tx_hash=d.tx_hash
LEFT JOIN address_dictionary a ON a.address=d.source
LEFT JOIN asset_dictionary s ON s.asset=d.asset
LEFT JOIN asset_dictionary p ON p.asset=d.dividend_asset
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,asset_id=excluded.asset_id,dividend_asset_id=excluded.dividend_asset_id,
  quantity_per_unit=excluded.quantity_per_unit,
  quantity_per_unit_normalized=excluded.quantity_per_unit_normalized,
  fee_paid=excluded.fee_paid,status=excluded.status;

INSERT INTO broadcasts(
  tx_index,tx_hash,block_index,block_time,source_id,timestamp,value,fee_fraction_int,text,locked,mime_type,
  status,btns,btns_op,btns_tick
)
SELECT t.tx_index,unhex(b.tx_hash),b.block_index,b.block_time,a.address_id,b.timestamp,b.value,
       b.fee_fraction_int,b.text,b.locked,b.mime_type,b.status,b.btns,b.btns_op,b.btns_tick
FROM source.broadcasts b
JOIN source.transactions t ON t.tx_hash=b.tx_hash
LEFT JOIN address_dictionary a ON a.address=b.source
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,timestamp=excluded.timestamp,value=excluded.value,
  fee_fraction_int=excluded.fee_fraction_int,text=excluded.text,locked=excluded.locked,
  mime_type=excluded.mime_type,status=excluded.status,btns=excluded.btns,
  btns_op=excluded.btns_op,btns_tick=excluded.btns_tick;

INSERT INTO cancels(tx_index,tx_hash,block_index,block_time,source_id,offer_tx_index,status)
SELECT t.tx_index,unhex(c.tx_hash),c.block_index,c.block_time,a.address_id,o.tx_index,c.status
FROM source.cancels c
JOIN source.transactions t ON t.tx_hash=c.tx_hash
LEFT JOIN source.transactions o ON o.tx_hash=c.offer_hash
LEFT JOIN address_dictionary a ON a.address=c.source
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
  source_id=excluded.source_id,offer_tx_index=excluded.offer_tx_index,status=excluded.status;

INSERT INTO btcpays(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,order_match_tx0_index,
  order_match_tx1_index,btc_amount,btc_amount_normalized,status
)
SELECT b.event_index,t.tx_index,unhex(b.tx_hash),b.block_index,b.block_time,s.address_id,d.address_id,
       t0.tx_index,t1.tx_index,b.btc_amount,b.btc_amount_normalized,b.status
FROM source.btcpays b
JOIN source.transactions t ON t.tx_hash=b.tx_hash
JOIN source.transactions t0 ON t0.tx_hash=substr(b.order_match_id,1,64)
JOIN source.transactions t1 ON t1.tx_hash=substr(b.order_match_id,66,64)
LEFT JOIN address_dictionary s ON s.address=b.source
LEFT JOIN address_dictionary d ON d.address=b.destination
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,
  destination_id=excluded.destination_id,order_match_tx0_index=excluded.order_match_tx0_index,
  order_match_tx1_index=excluded.order_match_tx1_index,btc_amount=excluded.btc_amount,
  btc_amount_normalized=excluded.btc_amount_normalized,status=excluded.status;

INSERT INTO bets(
  tx_index,tx_hash,block_index,block_time,source_id,feed_address_id,bet_type,deadline,wager_quantity,
  wager_remaining,counterwager_quantity,counterwager_remaining,target_value,leverage,expiration,expire_index,
  fee_fraction_int,status
)
SELECT t.tx_index,unhex(b.tx_hash),b.block_index,b.block_time,s.address_id,f.address_id,b.bet_type,b.deadline,
       b.wager_quantity,b.wager_remaining,b.counterwager_quantity,b.counterwager_remaining,b.target_value,
       b.leverage,b.expiration,b.expire_index,b.fee_fraction_int,b.status
FROM source.bets b
JOIN source.transactions t ON t.tx_hash=b.tx_hash
LEFT JOIN address_dictionary s ON s.address=b.source
LEFT JOIN address_dictionary f ON f.address=b.feed_address
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
  feed_address_id=excluded.feed_address_id,bet_type=excluded.bet_type,deadline=excluded.deadline,
  wager_quantity=excluded.wager_quantity,wager_remaining=excluded.wager_remaining,
  counterwager_quantity=excluded.counterwager_quantity,
  counterwager_remaining=excluded.counterwager_remaining,target_value=excluded.target_value,
  leverage=excluded.leverage,expiration=excluded.expiration,expire_index=excluded.expire_index,
  fee_fraction_int=excluded.fee_fraction_int,status=excluded.status;

INSERT INTO bet_matches(
  tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,feed_address_id,forward_quantity,
  backward_quantity,deadline,target_value,leverage,initial_value,block_index,block_time,status,tx0_bet_type,
  tx1_bet_type,fee_fraction_int,match_expire_index
)
SELECT t0.tx_index,t1.tx_index,unhex(m.tx0_hash),unhex(m.tx1_hash),a0.address_id,a1.address_id,f.address_id,
       m.forward_quantity,m.backward_quantity,m.deadline,m.target_value,m.leverage,m.initial_value,m.block_index,
       m.block_time,m.status,m.tx0_bet_type,m.tx1_bet_type,m.fee_fraction_int,m.match_expire_index
FROM source.bet_matches m
JOIN source.transactions t0 ON t0.tx_hash=m.tx0_hash
JOIN source.transactions t1 ON t1.tx_hash=m.tx1_hash
LEFT JOIN address_dictionary a0 ON a0.address=m.tx0_address
LEFT JOIN address_dictionary a1 ON a1.address=m.tx1_address
LEFT JOIN address_dictionary f ON f.address=m.feed_address
WHERE true
ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET
  tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,
  tx0_address_id=excluded.tx0_address_id,tx1_address_id=excluded.tx1_address_id,
  feed_address_id=excluded.feed_address_id,forward_quantity=excluded.forward_quantity,
  backward_quantity=excluded.backward_quantity,deadline=excluded.deadline,
  target_value=excluded.target_value,leverage=excluded.leverage,
  initial_value=excluded.initial_value,block_index=excluded.block_index,
  block_time=excluded.block_time,status=excluded.status,tx0_bet_type=excluded.tx0_bet_type,
  tx1_bet_type=excluded.tx1_bet_type,fee_fraction_int=excluded.fee_fraction_int,
  match_expire_index=excluded.match_expire_index;

INSERT INTO bet_match_resolutions(
  event_index,tx_hash,block_index,block_time,bet_match_tx0_index,bet_match_tx1_index,bet_match_type_id,
  winner_id,settled,bull_credit,bear_credit,escrow_less_fee,fee,status
)
SELECT r.event_index,unhex(r.tx_hash),r.block_index,r.block_time,t0.tx_index,t1.tx_index,r.bet_match_type_id,
       w.address_id,r.settled,r.bull_credit,r.bear_credit,r.escrow_less_fee,r.fee,r.status
FROM source.bet_match_resolutions r
JOIN source.transactions t0 ON t0.tx_hash=substr(r.bet_match_id,1,64)
JOIN source.transactions t1 ON t1.tx_hash=substr(r.bet_match_id,66,64)
LEFT JOIN address_dictionary w ON w.address=r.winner
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  block_index=excluded.block_index,block_time=excluded.block_time,
  bet_match_tx0_index=excluded.bet_match_tx0_index,
  bet_match_tx1_index=excluded.bet_match_tx1_index,
  bet_match_type_id=excluded.bet_match_type_id,winner_id=excluded.winner_id,
  settled=excluded.settled,bull_credit=excluded.bull_credit,bear_credit=excluded.bear_credit,
  escrow_less_fee=excluded.escrow_less_fee,fee=excluded.fee,status=excluded.status;

INSERT INTO rps(
  tx_index,tx_hash,block_index,block_time,source_id,possible_moves,wager,move_random_hash,expiration,
  expire_index,status
)
SELECT t.tx_index,unhex(r.tx_hash),r.block_index,r.block_time,a.address_id,r.possible_moves,r.wager,
       unhex(r.move_random_hash),r.expiration,r.expire_index,r.status
FROM source.rps r
JOIN source.transactions t ON t.tx_hash=r.tx_hash
LEFT JOIN address_dictionary a ON a.address=r.source
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
  possible_moves=excluded.possible_moves,wager=excluded.wager,move_random_hash=excluded.move_random_hash,
  expiration=excluded.expiration,expire_index=excluded.expire_index,status=excluded.status;

INSERT INTO rps_matches(
  tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,possible_moves,wager,block_index,
  block_time,status
)
SELECT t0.tx_index,t1.tx_index,unhex(m.tx0_hash),unhex(m.tx1_hash),a0.address_id,a1.address_id,
       m.possible_moves,m.wager,m.block_index,m.block_time,m.status
FROM source.rps_matches m
JOIN source.transactions t0 ON t0.tx_hash=m.tx0_hash
JOIN source.transactions t1 ON t1.tx_hash=m.tx1_hash
LEFT JOIN address_dictionary a0 ON a0.address=m.tx0_address
LEFT JOIN address_dictionary a1 ON a1.address=m.tx1_address
WHERE true
ON CONFLICT(tx0_index,tx1_index) DO UPDATE SET
  tx0_hash=excluded.tx0_hash,tx1_hash=excluded.tx1_hash,
  tx0_address_id=excluded.tx0_address_id,tx1_address_id=excluded.tx1_address_id,
  possible_moves=excluded.possible_moves,wager=excluded.wager,
  block_index=excluded.block_index,block_time=excluded.block_time,status=excluded.status;

INSERT INTO dispensers(
  tx_index,tx_hash,block_index,block_time,source_id,asset_id,give_quantity,give_quantity_normalized,
  escrow_quantity,give_remaining,give_remaining_normalized,satoshirate,satoshirate_normalized,status,
  oracle_address_id,dispense_count,closed_block_index,origin_id,last_status_tx_hash
)
SELECT t.tx_index,unhex(d.tx_hash),d.block_index,d.block_time,s.address_id,a.asset_id,d.give_quantity,
       d.give_quantity_normalized,d.escrow_quantity,d.give_remaining,d.give_remaining_normalized,d.satoshirate,
       d.satoshirate_normalized,d.status,o.address_id,d.dispense_count,d.closed_block_index,g.address_id,
       unhex(d.last_status_tx_hash)
FROM source.dispensers d
JOIN source.transactions t ON t.tx_hash=d.tx_hash
JOIN address_dictionary s ON s.address=d.source
JOIN asset_dictionary a ON a.asset=d.asset
LEFT JOIN address_dictionary o ON o.address=d.oracle_address
LEFT JOIN address_dictionary g ON g.address=d.origin
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
  asset_id=excluded.asset_id,give_quantity=excluded.give_quantity,
  give_quantity_normalized=excluded.give_quantity_normalized,escrow_quantity=excluded.escrow_quantity,
  give_remaining=excluded.give_remaining,give_remaining_normalized=excluded.give_remaining_normalized,
  satoshirate=excluded.satoshirate,satoshirate_normalized=excluded.satoshirate_normalized,status=excluded.status,
  oracle_address_id=excluded.oracle_address_id,dispense_count=excluded.dispense_count,
  closed_block_index=excluded.closed_block_index,origin_id=excluded.origin_id,
  last_status_tx_hash=excluded.last_status_tx_hash;

INSERT INTO dispenses(
  event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,source_id,destination_id,asset_id,
  dispense_quantity,dispense_quantity_normalized,btc_amount,block_index,block_time
)
SELECT d.event_index,t.tx_index,d.dispense_index,unhex(d.tx_hash),p.tx_index,s.address_id,g.address_id,a.asset_id,
       d.dispense_quantity,d.dispense_quantity_normalized,d.btc_amount,d.block_index,d.block_time
FROM source.dispenses d
JOIN source.transactions t ON t.tx_hash=d.tx_hash
JOIN source.transactions p ON p.tx_hash=d.dispenser_tx_hash
JOIN address_dictionary s ON s.address=d.source
JOIN address_dictionary g ON g.address=d.destination
JOIN asset_dictionary a ON a.asset=d.asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,dispense_index=excluded.dispense_index,
  dispenser_tx_index=excluded.dispenser_tx_index,source_id=excluded.source_id,
  destination_id=excluded.destination_id,asset_id=excluded.asset_id,
  dispense_quantity=excluded.dispense_quantity,
  dispense_quantity_normalized=excluded.dispense_quantity_normalized,
  btc_amount=excluded.btc_amount,block_index=excluded.block_index,block_time=excluded.block_time;

INSERT INTO dispenser_refills(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,asset_id,dispense_quantity,
  dispenser_tx_index
)
SELECT d.event_index,t.tx_index,unhex(d.tx_hash),d.block_index,d.block_time,s.address_id,g.address_id,a.asset_id,
       d.dispense_quantity,p.tx_index
FROM source.dispenser_refills d
JOIN source.transactions t ON t.tx_hash=d.tx_hash
JOIN source.transactions p ON p.tx_hash=d.dispenser_tx_hash
JOIN address_dictionary s ON s.address=d.source
JOIN address_dictionary g ON g.address=d.destination
JOIN asset_dictionary a ON a.asset=d.asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,
  destination_id=excluded.destination_id,asset_id=excluded.asset_id,
  dispense_quantity=excluded.dispense_quantity,dispenser_tx_index=excluded.dispenser_tx_index;

INSERT INTO fairminters(
  tx_index,tx_hash,block_index,block_time,source_id,asset_id,asset_parent_id,asset_longname,description,price,
  quantity_by_price,hard_cap,burn_payment,max_mint_per_tx,premint_quantity,start_block,end_block,
  minted_asset_commission_int,soft_cap,soft_cap_deadline_block,lock_description,lock_quantity,divisible,
  pre_minted,status,max_mint_per_address,mime_type,earned_quantity,paid_quantity,pool_quantity,lp_asset
)
SELECT t.tx_index,unhex(f.tx_hash),f.block_index,f.block_time,s.address_id,a.asset_id,p.asset_id,f.asset_longname,
       f.description,f.price,f.quantity_by_price,f.hard_cap,f.burn_payment,f.max_mint_per_tx,f.premint_quantity,
       f.start_block,f.end_block,f.minted_asset_commission_int,f.soft_cap,f.soft_cap_deadline_block,
       f.lock_description,f.lock_quantity,f.divisible,f.pre_minted,f.status,f.max_mint_per_address,f.mime_type,
       f.earned_quantity,f.paid_quantity,f.pool_quantity,f.lp_asset
FROM source.fairminters f
JOIN source.transactions t ON t.tx_hash=f.tx_hash
LEFT JOIN address_dictionary s ON s.address=f.source
LEFT JOIN asset_dictionary a ON a.asset=f.asset
LEFT JOIN asset_dictionary p ON p.asset=f.asset_parent
WHERE true
ON CONFLICT(tx_index) DO UPDATE SET
  block_index=excluded.block_index,block_time=excluded.block_time,source_id=excluded.source_id,
  asset_id=excluded.asset_id,asset_parent_id=excluded.asset_parent_id,asset_longname=excluded.asset_longname,
  description=excluded.description,price=excluded.price,quantity_by_price=excluded.quantity_by_price,
  hard_cap=excluded.hard_cap,burn_payment=excluded.burn_payment,max_mint_per_tx=excluded.max_mint_per_tx,
  premint_quantity=excluded.premint_quantity,start_block=excluded.start_block,end_block=excluded.end_block,
  minted_asset_commission_int=excluded.minted_asset_commission_int,soft_cap=excluded.soft_cap,
  soft_cap_deadline_block=excluded.soft_cap_deadline_block,lock_description=excluded.lock_description,
  lock_quantity=excluded.lock_quantity,divisible=excluded.divisible,pre_minted=excluded.pre_minted,
  status=excluded.status,max_mint_per_address=excluded.max_mint_per_address,mime_type=excluded.mime_type,
  earned_quantity=excluded.earned_quantity,paid_quantity=excluded.paid_quantity,
  pool_quantity=excluded.pool_quantity,lp_asset=excluded.lp_asset;

INSERT INTO fairmints(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,fairminter_tx_index,asset_id,earn_quantity,
  paid_quantity,commission,status
)
SELECT f.event_index,t.tx_index,unhex(f.tx_hash),f.block_index,f.block_time,s.address_id,p.tx_index,a.asset_id,
       f.earn_quantity,f.paid_quantity,f.commission,f.status
FROM source.fairmints f
JOIN source.transactions t ON t.tx_hash=f.tx_hash
LEFT JOIN source.transactions p ON p.tx_hash=f.fairminter_tx_hash
LEFT JOIN address_dictionary s ON s.address=f.source
LEFT JOIN asset_dictionary a ON a.asset=f.asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,
  fairminter_tx_index=excluded.fairminter_tx_index,asset_id=excluded.asset_id,
  earn_quantity=excluded.earn_quantity,paid_quantity=excluded.paid_quantity,
  commission=excluded.commission,status=excluded.status;

INSERT INTO pools(
  asset_a_id,asset_b_id,lp_asset,pair,reserve_a,reserve_b,lp_supply,price,status,block_index,
  updated_block_index
)
SELECT a.asset_id,b.asset_id,p.lp_asset,p.pair,p.reserve_a,p.reserve_b,p.lp_supply,p.price,p.status,p.block_index,
       p.updated_block_index
FROM source.pools p
JOIN asset_dictionary a ON a.asset=p.asset_a
JOIN asset_dictionary b ON b.asset=p.asset_b
WHERE true
ON CONFLICT(asset_a_id,asset_b_id) DO UPDATE SET
  lp_asset=excluded.lp_asset,pair=excluded.pair,reserve_a=excluded.reserve_a,reserve_b=excluded.reserve_b,
  lp_supply=excluded.lp_supply,price=excluded.price,status=excluded.status,block_index=excluded.block_index,
  updated_block_index=excluded.updated_block_index;

INSERT INTO pool_matches(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,lp_asset,pair,forward_asset_id,
  forward_quantity,backward_asset_id,backward_quantity,fee_quantity,fee_bps,order_tx_index,status
)
SELECT p.event_index,t.tx_index,unhex(p.tx_hash),p.block_index,p.block_time,s.address_id,p.lp_asset,p.pair,
       f.asset_id,p.forward_quantity,b.asset_id,p.backward_quantity,p.fee_quantity,p.fee_bps,o.tx_index,p.status
FROM source.pool_matches p
JOIN source.transactions t ON t.tx_hash=p.tx_hash
LEFT JOIN source.transactions o ON o.tx_hash=p.order_tx_hash
LEFT JOIN address_dictionary s ON s.address=p.source
LEFT JOIN asset_dictionary f ON f.asset=p.forward_asset
LEFT JOIN asset_dictionary b ON b.asset=p.backward_asset
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,lp_asset=excluded.lp_asset,
  pair=excluded.pair,forward_asset_id=excluded.forward_asset_id,
  forward_quantity=excluded.forward_quantity,backward_asset_id=excluded.backward_asset_id,
  backward_quantity=excluded.backward_quantity,fee_quantity=excluded.fee_quantity,
  fee_bps=excluded.fee_bps,order_tx_index=excluded.order_tx_index,status=excluded.status;

INSERT INTO pool_liquidity(
  event_index,tx_index,tx_hash,block_index,block_time,source_id,kind,asset_a_id,asset_b_id,quantity_a,
  quantity_b,quantity_minted,quantity_destroyed,status
)
SELECT p.event_index,t.tx_index,unhex(p.tx_hash),p.block_index,p.block_time,s.address_id,p.kind,a.asset_id,b.asset_id,
       p.quantity_a,p.quantity_b,p.quantity_minted,p.quantity_destroyed,p.status
FROM source.pool_liquidity p
JOIN source.transactions t ON t.tx_hash=p.tx_hash
LEFT JOIN address_dictionary s ON s.address=p.source
LEFT JOIN asset_dictionary a ON a.asset=p.asset_a
LEFT JOIN asset_dictionary b ON b.asset=p.asset_b
WHERE true
ON CONFLICT(event_index) DO UPDATE SET
  tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
  block_time=excluded.block_time,source_id=excluded.source_id,kind=excluded.kind,
  asset_a_id=excluded.asset_a_id,asset_b_id=excluded.asset_b_id,
  quantity_a=excluded.quantity_a,quantity_b=excluded.quantity_b,
  quantity_minted=excluded.quantity_minted,quantity_destroyed=excluded.quantity_destroyed,
  status=excluded.status;

COMMIT;
