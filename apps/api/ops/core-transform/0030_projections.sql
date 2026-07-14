BEGIN IMMEDIATE;

INSERT INTO address_signals(
  address_id,first_block,last_block,out_peers,in_peers,dispense_btc,dispenses,dividends,
  assets_issued,locked_assets,btc_spent,btc_fees,assets_held,assets_received,survived_assets,
  assets_distributed,assets_hits,rep_score,clean_dispense_btc,clean_btc_spent,is_exchange,
  is_deposit,is_burn,assets_burned,disp_trust,is_emblem_vault,likely_service,dex_trades,
  stamps_created,stamps_collected,src20_deploys,is_btns_user,graph_trust,graph_distrust,
  vault_scams,shell_scams,dump_scams
)
SELECT d.address_id,s.first_block,coalesce(s.last_block,0),coalesce(s.out_peers,0),
  coalesce(s.in_peers,0),coalesce(s.dispense_btc,0),coalesce(s.dispenses,0),
  coalesce(s.dividends,0),coalesce(s.assets_issued,0),coalesce(s.locked_assets,0),
  coalesce(s.btc_spent,0),coalesce(s.btc_fees,0),coalesce(s.assets_held,0),
  coalesce(s.assets_received,0),coalesce(s.survived_assets,0),coalesce(s.assets_distributed,0),
  coalesce(s.assets_hits,0),coalesce(s.rep_score,1),coalesce(s.clean_dispense_btc,0),
  coalesce(s.clean_btc_spent,0),coalesce(s.is_exchange,0),coalesce(s.is_deposit,0),
  coalesce(s.is_burn,0),coalesce(s.assets_burned,0),coalesce(s.disp_trust,0),
  coalesce(s.is_emblem_vault,0),coalesce(s.likely_service,0),coalesce(s.dex_trades,0),
  coalesce(s.stamps_created,0),coalesce(s.stamps_collected,0),coalesce(s.src20_deploys,0),
  coalesce(s.is_btns_user,0),coalesce(s.graph_trust,0),coalesce(s.graph_distrust,0),
  coalesce(s.vault_scams,0),coalesce(s.shell_scams,0),coalesce(s.dump_scams,0)
FROM source.address_signals s JOIN address_dictionary d ON d.address=s.address
WHERE true
ON CONFLICT(address_id) DO UPDATE SET
  first_block=excluded.first_block,last_block=excluded.last_block,out_peers=excluded.out_peers,
  in_peers=excluded.in_peers,dispense_btc=excluded.dispense_btc,dispenses=excluded.dispenses,
  dividends=excluded.dividends,assets_issued=excluded.assets_issued,locked_assets=excluded.locked_assets,
  btc_spent=excluded.btc_spent,btc_fees=excluded.btc_fees,assets_held=excluded.assets_held,
  assets_received=excluded.assets_received,survived_assets=excluded.survived_assets,
  assets_distributed=excluded.assets_distributed,assets_hits=excluded.assets_hits,
  rep_score=excluded.rep_score,clean_dispense_btc=excluded.clean_dispense_btc,
  clean_btc_spent=excluded.clean_btc_spent,is_exchange=excluded.is_exchange,
  is_deposit=excluded.is_deposit,is_burn=excluded.is_burn,assets_burned=excluded.assets_burned,
  disp_trust=excluded.disp_trust,is_emblem_vault=excluded.is_emblem_vault,
  likely_service=excluded.likely_service,dex_trades=excluded.dex_trades,
  stamps_created=excluded.stamps_created,stamps_collected=excluded.stamps_collected,
  src20_deploys=excluded.src20_deploys,is_btns_user=excluded.is_btns_user,
  graph_trust=excluded.graph_trust,graph_distrust=excluded.graph_distrust,
  vault_scams=excluded.vault_scams,shell_scams=excluded.shell_scams,dump_scams=excluded.dump_scams;

INSERT INTO asset_signals(
  asset_id,issuer_id,divisible,locked,holders,top1_pct,trades,self_trade_pct,first_trade_blk,
  last_trade_blk,dispenses,dispense_btc,low_quality,holder_breadth,pct_creator_holders,
  burned_pct,distinct_traders,distinct_dispensers,age_blocks,avg_holder_dex,recent_events,
  recency_blocks,max_dispense_btc,max_trade_xcp,supply,max_realized_usd,
  distinct_dispense_buyers,max_dispense_btc_clean,emblem_trades,graph_trust,graph_distrust,
  holder_cohesion,cohesion_edges,cohesion_strong
)
SELECT a.asset_id,i.address_id,s.divisible,s.locked,coalesce(s.holders,0),coalesce(s.top1_pct,0),
  coalesce(s.trades,0),coalesce(s.self_trade_pct,0),coalesce(s.first_trade_blk,0),
  coalesce(s.last_trade_blk,0),coalesce(s.dispenses,0),coalesce(s.dispense_btc,0),
  coalesce(s.low_quality,0),coalesce(s.holder_breadth,0),coalesce(s.pct_creator_holders,0),
  coalesce(s.burned_pct,0),coalesce(s.distinct_traders,0),coalesce(s.distinct_dispensers,0),
  coalesce(s.age_blocks,0),coalesce(s.avg_holder_dex,0),coalesce(s.recent_events,0),
  coalesce(s.recency_blocks,0),coalesce(s.max_dispense_btc,0),coalesce(s.max_trade_xcp,0),
  coalesce(s.supply,0),coalesce(s.max_realized_usd,0),coalesce(s.distinct_dispense_buyers,0),
  coalesce(s.max_dispense_btc_clean,0),coalesce(s.emblem_trades,0),coalesce(s.graph_trust,0),
  coalesce(s.graph_distrust,0),s.holder_cohesion,s.cohesion_edges,s.cohesion_strong
FROM source.asset_signals s
JOIN asset_dictionary a ON a.asset=s.asset
LEFT JOIN address_dictionary i ON i.address=s.issuer
WHERE true
ON CONFLICT(asset_id) DO UPDATE SET
  issuer_id=excluded.issuer_id,divisible=excluded.divisible,locked=excluded.locked,
  holders=excluded.holders,top1_pct=excluded.top1_pct,trades=excluded.trades,
  self_trade_pct=excluded.self_trade_pct,first_trade_blk=excluded.first_trade_blk,
  last_trade_blk=excluded.last_trade_blk,dispenses=excluded.dispenses,
  dispense_btc=excluded.dispense_btc,low_quality=excluded.low_quality,
  holder_breadth=excluded.holder_breadth,pct_creator_holders=excluded.pct_creator_holders,
  burned_pct=excluded.burned_pct,distinct_traders=excluded.distinct_traders,
  distinct_dispensers=excluded.distinct_dispensers,age_blocks=excluded.age_blocks,
  avg_holder_dex=excluded.avg_holder_dex,recent_events=excluded.recent_events,
  recency_blocks=excluded.recency_blocks,max_dispense_btc=excluded.max_dispense_btc,
  max_trade_xcp=excluded.max_trade_xcp,supply=excluded.supply,
  max_realized_usd=excluded.max_realized_usd,
  distinct_dispense_buyers=excluded.distinct_dispense_buyers,
  max_dispense_btc_clean=excluded.max_dispense_btc_clean,emblem_trades=excluded.emblem_trades,
  graph_trust=excluded.graph_trust,graph_distrust=excluded.graph_distrust,
  holder_cohesion=excluded.holder_cohesion,cohesion_edges=excluded.cohesion_edges,
  cohesion_strong=excluded.cohesion_strong;

INSERT INTO asset_feed_counts(
  asset_id,sales,issuances,dispensers,dispenses,orders,sends,fairmints,dividends,
  destructions,pools,subassets,updated_at
)
SELECT a.asset_id,s.sales,s.issuances,s.dispensers,s.dispenses,s.orders,s.sends,s.fairmints,
  s.dividends,s.destructions,s.pools,s.subassets,s.updated_at
FROM source.asset_feed_counts s JOIN asset_dictionary a ON a.asset=s.asset
WHERE true
ON CONFLICT(asset_id) DO UPDATE SET
  sales=excluded.sales,issuances=excluded.issuances,dispensers=excluded.dispensers,
  dispenses=excluded.dispenses,orders=excluded.orders,sends=excluded.sends,
  fairmints=excluded.fairmints,dividends=excluded.dividends,destructions=excluded.destructions,
  pools=excluded.pools,subassets=excluded.subassets,updated_at=excluded.updated_at;

INSERT INTO btc_signals(address_id,btc_received,btc_sent,btc_balance,btc_txs,btc_first_block,btc_last_block,updated_at)
SELECT a.address_id,s.btc_received,s.btc_sent,s.btc_balance,s.btc_txs,s.btc_first_blk,s.btc_last_blk,s.updated_at
FROM source.btc_signals s JOIN address_dictionary a ON a.address=s.addr
WHERE true
ON CONFLICT(address_id) DO UPDATE SET
  btc_received=excluded.btc_received,btc_sent=excluded.btc_sent,btc_balance=excluded.btc_balance,
  btc_txs=excluded.btc_txs,btc_first_block=excluded.btc_first_block,
  btc_last_block=excluded.btc_last_block,updated_at=excluded.updated_at;

INSERT INTO tags(entity_id,tag,source,value,meta)
SELECT e.entity_id,s.tag,s.source,s.value,s.meta
FROM source.tags s
JOIN entity_dictionary e ON e.entity_type=s.entity_type AND e.entity_key=s.entity_id
WHERE true
ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,value=excluded.value,meta=excluded.meta;

INSERT INTO graph_edges(source_id,destination_id,weight,edge_block)
SELECT a.address_id,b.address_id,s.w,s.edge_block
FROM source.graph_edges s
JOIN address_dictionary a ON a.address=s.src
JOIN address_dictionary b ON b.address=s.dst
WHERE true
ON CONFLICT(source_id,destination_id) DO UPDATE SET weight=excluded.weight,edge_block=excluded.edge_block;

INSERT INTO graph_node(address_id,outsum,insum)
SELECT a.address_id,s.outsum,s.insum FROM source.graph_node s
JOIN address_dictionary a ON a.address=s.id
WHERE true
ON CONFLICT(address_id) DO UPDATE SET outsum=excluded.outsum,insum=excluded.insum;

INSERT INTO graph_rank(address_id,slot,score,rank,normalized_rank)
SELECT a.address_id,s.slot,s.s,s.r,s.rn FROM source.graph_rank s
JOIN address_dictionary a ON a.address=s.node
WHERE true
ON CONFLICT(address_id,slot) DO UPDATE SET
  score=excluded.score,rank=excluded.rank,normalized_rank=excluded.normalized_rank;

INSERT INTO graph_seed(address_id,slot,score)
SELECT a.address_id,s.slot,s.s FROM source.graph_seed s
JOIN address_dictionary a ON a.address=s.node
WHERE true
ON CONFLICT(address_id,slot) DO UPDATE SET score=excluded.score;

INSERT INTO graph_inflow(address_id,value)
SELECT a.address_id,s.v FROM source.graph_inflow s
JOIN address_dictionary a ON a.address=s.node
WHERE true
ON CONFLICT(address_id) DO UPDATE SET value=excluded.value;

INSERT INTO graph_baseline(entity_id,trust,distrust)
SELECT e.entity_id,s.trust,s.distrust FROM source.graph_baseline s
JOIN entity_dictionary e
  ON e.entity_type=CASE s.kind WHEN 'addr' THEN 'address' ELSE s.kind END AND e.entity_key=s.id
WHERE true
ON CONFLICT(entity_id) DO UPDATE SET trust=excluded.trust,distrust=excluded.distrust;

INSERT INTO pr_edges(source_id,destination_id,multiplicity)
SELECT a.address_id,b.address_id,count(*)
FROM source.pr_edges s
JOIN address_dictionary a ON a.address=s.s
JOIN address_dictionary b ON b.address=s.d
GROUP BY a.address_id,b.address_id
ON CONFLICT(source_id,destination_id) DO UPDATE SET multiplicity=excluded.multiplicity;

INSERT INTO trades(
  venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,
  buyer_id,seller_id,tx_hash,external_tx_hash,sale_class
)
SELECT s.venue,s.ref,a.asset_id,s.block_time,s.block_index,s.quantity,s.currency,s.total,s.usd_value,
  b.address_id,v.address_id,
  CASE WHEN length(s.tx_hash)=64 AND lower(s.tx_hash) NOT GLOB '*[^0-9a-f]*' THEN unhex(s.tx_hash) END,
  CASE WHEN length(s.tx_hash)=64 AND lower(s.tx_hash) NOT GLOB '*[^0-9a-f]*' THEN NULL ELSE s.tx_hash END,
  s.sale_class
FROM source.trades s
LEFT JOIN asset_dictionary a ON a.asset=s.asset
LEFT JOIN address_dictionary b ON b.address=s.buyer
LEFT JOIN address_dictionary v ON v.address=s.seller
WHERE true
ON CONFLICT(venue,ref) DO UPDATE SET
  asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
  quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,usd_value=excluded.usd_value,
  buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash,
  external_tx_hash=excluded.external_tx_hash,sale_class=excluded.sale_class;

INSERT INTO prices(day,currency,usd,source)
SELECT day,currency,usd,source FROM source.prices WHERE true
ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source;

INSERT INTO xcp_btc_daily(day,xcpbtc)
SELECT day,xcpbtc FROM source.xcp_btc_daily WHERE true
ON CONFLICT(day) DO UPDATE SET xcpbtc=excluded.xcpbtc;

INSERT INTO network_stats_snapshot(
  singleton,assets,transactions,balances,sends,issuances,dispensers,dispenses,orders,
  order_matches,sweeps,broadcasts,dividends,fairmints,destructions,holders,btc_fees,
  xcp_destroyed,xcp_supply,updated_at
)
SELECT singleton,assets,transactions,balances,sends,issuances,dispensers,dispenses,orders,
  order_matches,sweeps,broadcasts,dividends,fairmints,destructions,holders,btc_fees,
  xcp_destroyed,xcp_supply,updated_at
FROM source.network_stats_snapshot WHERE true
ON CONFLICT(singleton) DO UPDATE SET
  assets=excluded.assets,transactions=excluded.transactions,balances=excluded.balances,
  sends=excluded.sends,issuances=excluded.issuances,dispensers=excluded.dispensers,
  dispenses=excluded.dispenses,orders=excluded.orders,order_matches=excluded.order_matches,
  sweeps=excluded.sweeps,broadcasts=excluded.broadcasts,dividends=excluded.dividends,
  fairmints=excluded.fairmints,destructions=excluded.destructions,holders=excluded.holders,
  btc_fees=excluded.btc_fees,xcp_destroyed=excluded.xcp_destroyed,
  xcp_supply=excluded.xcp_supply,updated_at=excluded.updated_at;

INSERT INTO curated(kind,key,value,note)
SELECT kind,key,value,note FROM source.curated WHERE true
ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,note=excluded.note;

INSERT INTO exchange_top_assets(generation,asset_id,depositors)
SELECT s.generation,a.asset_id,s.depositors FROM source.exchange_top_assets s
JOIN asset_dictionary a ON a.asset=s.asset
WHERE true
ON CONFLICT(generation,asset_id) DO UPDATE SET depositors=excluded.depositors;

INSERT INTO emblem_vaults(
  token_id,contract_id,btc_address_id,resolved,first_seen,contents_asset_id,contents_qty,
  vault_kind,funded,cracked_at,cracker_address_id,classified,claimed_name,claimed_asset_id,
  content_coins,has_contents,emblem_fraud,meta_crawled,is_scam_shell,is_dump
)
SELECT s.token_id,c.address_id,b.address_id,s.resolved,s.first_seen,a.asset_id,s.contents_qty,
  s.vault_kind,s.funded,s.cracked_at,r.address_id,s.classified,s.claimed_name,q.asset_id,
  s.content_coins,s.has_contents,s.emblem_fraud,s.meta_crawled,s.is_scam_shell,s.is_dump
FROM source.emblem_vaults s
LEFT JOIN address_dictionary c ON c.address=s.contract
LEFT JOIN address_dictionary b ON b.address=s.btc_address
LEFT JOIN asset_dictionary a ON a.asset=s.contents_asset
LEFT JOIN address_dictionary r ON r.address=s.cracker_address
LEFT JOIN asset_dictionary q ON q.asset=s.claimed_asset
WHERE true
ON CONFLICT(token_id) DO UPDATE SET
  contract_id=excluded.contract_id,btc_address_id=excluded.btc_address_id,resolved=excluded.resolved,
  first_seen=excluded.first_seen,contents_asset_id=excluded.contents_asset_id,
  contents_qty=excluded.contents_qty,vault_kind=excluded.vault_kind,funded=excluded.funded,
  cracked_at=excluded.cracked_at,cracker_address_id=excluded.cracker_address_id,
  classified=excluded.classified,claimed_name=excluded.claimed_name,
  claimed_asset_id=excluded.claimed_asset_id,content_coins=excluded.content_coins,
  has_contents=excluded.has_contents,emblem_fraud=excluded.emblem_fraud,
  meta_crawled=excluded.meta_crawled,is_scam_shell=excluded.is_scam_shell,is_dump=excluded.is_dump;

INSERT INTO emblem_sales(
  tx_hash,log_index,contract_id,token_id,price_raw,token_address_id,marketplace,
  buyer_id,seller_id,block_number
)
SELECT s.tx_hash,s.log_index,c.address_id,s.token_id,s.price_raw,t.address_id,s.marketplace,
  b.address_id,v.address_id,s.block_number
FROM source.emblem_sales s
LEFT JOIN address_dictionary c ON c.address=s.contract
LEFT JOIN address_dictionary t ON t.address=s.token_addr
LEFT JOIN address_dictionary b ON b.address=s.buyer
LEFT JOIN address_dictionary v ON v.address=s.seller
WHERE true
ON CONFLICT(tx_hash,log_index,contract_id,token_id) DO UPDATE SET
  price_raw=excluded.price_raw,
  token_address_id=excluded.token_address_id,marketplace=excluded.marketplace,
  buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,block_number=excluded.block_number;

INSERT INTO emblem_listings(
  contract_id,token_id,asset_id,order_id,marketplace,price_usd,price_amount,currency_id,url,expiry,updated_at
)
SELECT c.address_id,s.token_id,a.asset_id,s.order_id,s.marketplace,s.price_usd,s.price_amount,
  u.address_id,s.url,s.expiry,s.updated_at
FROM source.emblem_listings s
JOIN address_dictionary c ON c.address=s.contract
LEFT JOIN asset_dictionary a ON a.asset=s.asset
LEFT JOIN address_dictionary u ON u.address=s.currency
WHERE true
ON CONFLICT(contract_id,token_id) DO UPDATE SET
  asset_id=excluded.asset_id,order_id=excluded.order_id,marketplace=excluded.marketplace,
  price_usd=excluded.price_usd,price_amount=excluded.price_amount,currency_id=excluded.currency_id,
  url=excluded.url,expiry=excluded.expiry,updated_at=excluded.updated_at;

INSERT INTO emblem_scam_sellers(seller_id,scams)
SELECT a.address_id,s.scams FROM source.emblem_scam_sellers s
JOIN address_dictionary a ON a.address=s.seller
WHERE true
ON CONFLICT(seller_id) DO UPDATE SET scams=excluded.scams;

INSERT INTO scarce_city_sales(asset_id,sold_at,price_btc)
SELECT a.asset_id,s.sold_at,s.price_btc FROM source.scarce_city_sales s
JOIN asset_dictionary a ON a.asset=s.asset
WHERE true
ON CONFLICT(asset_id,sold_at) DO UPDATE SET price_btc=excluded.price_btc;

COMMIT;
