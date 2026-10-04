-- Bounded before-images for mutable chain state. The context row exists only
-- inside the same D1 transaction as the indexed writes, never between batches.
CREATE TABLE reorg_undo_context (singleton INTEGER PRIMARY KEY CHECK(singleton=1), block_index INTEGER NOT NULL);
CREATE TABLE reorg_undo_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), floor INTEGER NOT NULL);
CREATE TABLE reorg_undo (seq INTEGER PRIMARY KEY AUTOINCREMENT, block_index INTEGER NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, before_row TEXT);
CREATE INDEX idx_reorg_undo_block ON reorg_undo(block_index,seq);

CREATE TRIGGER reorg_undo_assets_insert AFTER INSERT ON assets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'assets',json_object('asset_id',NEW."asset_id"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_assets_update AFTER UPDATE ON assets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."asset_id" IS NOT NEW."asset_id" OR OLD."asset_longname" IS NOT NEW."asset_longname" OR OLD."numeric_asset_id" IS NOT NEW."numeric_asset_id" OR OLD."type" IS NOT NEW."type" OR OLD."issuer_id" IS NOT NEW."issuer_id" OR OLD."owner_id" IS NOT NEW."owner_id" OR OLD."divisible" IS NOT NEW."divisible" OR OLD."locked" IS NOT NEW."locked" OR OLD."description_locked" IS NOT NEW."description_locked" OR OLD."supply" IS NOT NEW."supply" OR OLD."supply_normalized" IS NOT NEW."supply_normalized" OR OLD."description" IS NOT NEW."description" OR OLD."mime_type" IS NOT NEW."mime_type" OR OLD."first_issuance_block_index" IS NOT NEW."first_issuance_block_index" OR OLD."last_issuance_block_index" IS NOT NEW."last_issuance_block_index" OR OLD."first_issuance_block_time" IS NOT NEW."first_issuance_block_time" OR OLD."last_issuance_block_time" IS NOT NEW."last_issuance_block_time" OR OLD."updated_at" IS NOT NEW."updated_at")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'assets',json_object('asset_id',OLD."asset_id"),json_object('asset_id',OLD."asset_id",'asset_longname',OLD."asset_longname",'numeric_asset_id',OLD."numeric_asset_id",'type',OLD."type",'issuer_id',OLD."issuer_id",'owner_id',OLD."owner_id",'divisible',OLD."divisible",'locked',OLD."locked",'description_locked',OLD."description_locked",'supply',OLD."supply",'supply_normalized',OLD."supply_normalized",'description',OLD."description",'mime_type',OLD."mime_type",'first_issuance_block_index',OLD."first_issuance_block_index",'last_issuance_block_index',OLD."last_issuance_block_index",'first_issuance_block_time',OLD."first_issuance_block_time",'last_issuance_block_time',OLD."last_issuance_block_time",'updated_at',OLD."updated_at") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_assets_delete AFTER DELETE ON assets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'assets',json_object('asset_id',OLD."asset_id"),json_object('asset_id',OLD."asset_id",'asset_longname',OLD."asset_longname",'numeric_asset_id',OLD."numeric_asset_id",'type',OLD."type",'issuer_id',OLD."issuer_id",'owner_id',OLD."owner_id",'divisible',OLD."divisible",'locked',OLD."locked",'description_locked',OLD."description_locked",'supply',OLD."supply",'supply_normalized',OLD."supply_normalized",'description',OLD."description",'mime_type',OLD."mime_type",'first_issuance_block_index',OLD."first_issuance_block_index",'last_issuance_block_index',OLD."last_issuance_block_index",'first_issuance_block_time',OLD."first_issuance_block_time",'last_issuance_block_time',OLD."last_issuance_block_time",'updated_at',OLD."updated_at") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_orders_insert AFTER INSERT ON orders
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'orders',json_object('tx_index',NEW."tx_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_orders_update AFTER UPDATE ON orders
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx_index" IS NOT NEW."tx_index" OR OLD."tx_hash" IS NOT NEW."tx_hash" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."source_id" IS NOT NEW."source_id" OR OLD."give_asset_id" IS NOT NEW."give_asset_id" OR OLD."give_quantity" IS NOT NEW."give_quantity" OR OLD."give_remaining" IS NOT NEW."give_remaining" OR OLD."get_asset_id" IS NOT NEW."get_asset_id" OR OLD."get_quantity" IS NOT NEW."get_quantity" OR OLD."get_remaining" IS NOT NEW."get_remaining" OR OLD."expiration" IS NOT NEW."expiration" OR OLD."expire_index" IS NOT NEW."expire_index" OR OLD."fee_required" IS NOT NEW."fee_required" OR OLD."fee_required_remaining" IS NOT NEW."fee_required_remaining" OR OLD."fee_provided" IS NOT NEW."fee_provided" OR OLD."fee_provided_remaining" IS NOT NEW."fee_provided_remaining" OR OLD."status" IS NOT NEW."status" OR OLD."closed_block_index" IS NOT NEW."closed_block_index")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'orders',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'give_asset_id',OLD."give_asset_id",'give_quantity',OLD."give_quantity",'give_remaining',OLD."give_remaining",'get_asset_id',OLD."get_asset_id",'get_quantity',OLD."get_quantity",'get_remaining',OLD."get_remaining",'expiration',OLD."expiration",'expire_index',OLD."expire_index",'fee_required',OLD."fee_required",'fee_required_remaining',OLD."fee_required_remaining",'fee_provided',OLD."fee_provided",'fee_provided_remaining',OLD."fee_provided_remaining",'status',OLD."status",'closed_block_index',OLD."closed_block_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_orders_delete AFTER DELETE ON orders
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'orders',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'give_asset_id',OLD."give_asset_id",'give_quantity',OLD."give_quantity",'give_remaining',OLD."give_remaining",'get_asset_id',OLD."get_asset_id",'get_quantity',OLD."get_quantity",'get_remaining',OLD."get_remaining",'expiration',OLD."expiration",'expire_index',OLD."expire_index",'fee_required',OLD."fee_required",'fee_required_remaining',OLD."fee_required_remaining",'fee_provided',OLD."fee_provided",'fee_provided_remaining',OLD."fee_provided_remaining",'status',OLD."status",'closed_block_index',OLD."closed_block_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_order_matches_insert AFTER INSERT ON order_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'order_matches',json_object('tx0_index',NEW."tx0_index",'tx1_index',NEW."tx1_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_order_matches_update AFTER UPDATE ON order_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx0_index" IS NOT NEW."tx0_index" OR OLD."tx1_index" IS NOT NEW."tx1_index" OR OLD."tx0_hash" IS NOT NEW."tx0_hash" OR OLD."tx1_hash" IS NOT NEW."tx1_hash" OR OLD."tx0_address_id" IS NOT NEW."tx0_address_id" OR OLD."tx1_address_id" IS NOT NEW."tx1_address_id" OR OLD."forward_asset_id" IS NOT NEW."forward_asset_id" OR OLD."forward_quantity" IS NOT NEW."forward_quantity" OR OLD."backward_asset_id" IS NOT NEW."backward_asset_id" OR OLD."backward_quantity" IS NOT NEW."backward_quantity" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."status" IS NOT NEW."status" OR OLD."match_expire_index" IS NOT NEW."match_expire_index" OR OLD."fee_paid" IS NOT NEW."fee_paid" OR OLD."tx0_block_index" IS NOT NEW."tx0_block_index" OR OLD."tx1_block_index" IS NOT NEW."tx1_block_index" OR OLD."tx0_expiration" IS NOT NEW."tx0_expiration" OR OLD."tx1_expiration" IS NOT NEW."tx1_expiration")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'order_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'forward_asset_id',OLD."forward_asset_id",'forward_quantity',OLD."forward_quantity",'backward_asset_id',OLD."backward_asset_id",'backward_quantity',OLD."backward_quantity",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status",'match_expire_index',OLD."match_expire_index",'fee_paid',OLD."fee_paid",'tx0_block_index',OLD."tx0_block_index",'tx1_block_index',OLD."tx1_block_index",'tx0_expiration',OLD."tx0_expiration",'tx1_expiration',OLD."tx1_expiration") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_order_matches_delete AFTER DELETE ON order_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'order_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'forward_asset_id',OLD."forward_asset_id",'forward_quantity',OLD."forward_quantity",'backward_asset_id',OLD."backward_asset_id",'backward_quantity',OLD."backward_quantity",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status",'match_expire_index',OLD."match_expire_index",'fee_paid',OLD."fee_paid",'tx0_block_index',OLD."tx0_block_index",'tx1_block_index',OLD."tx1_block_index",'tx0_expiration',OLD."tx0_expiration",'tx1_expiration',OLD."tx1_expiration") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_dispensers_insert AFTER INSERT ON dispensers
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'dispensers',json_object('tx_index',NEW."tx_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_dispensers_update AFTER UPDATE ON dispensers
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx_index" IS NOT NEW."tx_index" OR OLD."tx_hash" IS NOT NEW."tx_hash" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."source_id" IS NOT NEW."source_id" OR OLD."asset_id" IS NOT NEW."asset_id" OR OLD."give_quantity" IS NOT NEW."give_quantity" OR OLD."give_quantity_normalized" IS NOT NEW."give_quantity_normalized" OR OLD."escrow_quantity" IS NOT NEW."escrow_quantity" OR OLD."give_remaining" IS NOT NEW."give_remaining" OR OLD."give_remaining_normalized" IS NOT NEW."give_remaining_normalized" OR OLD."satoshirate" IS NOT NEW."satoshirate" OR OLD."satoshirate_normalized" IS NOT NEW."satoshirate_normalized" OR OLD."status" IS NOT NEW."status" OR OLD."oracle_address_id" IS NOT NEW."oracle_address_id" OR OLD."dispense_count" IS NOT NEW."dispense_count" OR OLD."closed_block_index" IS NOT NEW."closed_block_index" OR OLD."origin_id" IS NOT NEW."origin_id" OR OLD."last_status_tx_hash" IS NOT NEW."last_status_tx_hash")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'dispensers',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'asset_id',OLD."asset_id",'give_quantity',OLD."give_quantity",'give_quantity_normalized',OLD."give_quantity_normalized",'escrow_quantity',OLD."escrow_quantity",'give_remaining',OLD."give_remaining",'give_remaining_normalized',OLD."give_remaining_normalized",'satoshirate',OLD."satoshirate",'satoshirate_normalized',OLD."satoshirate_normalized",'status',OLD."status",'oracle_address_id',OLD."oracle_address_id",'dispense_count',OLD."dispense_count",'closed_block_index',OLD."closed_block_index",'origin_id',OLD."origin_id",'last_status_tx_hash',CASE WHEN OLD."last_status_tx_hash" IS NULL THEN NULL ELSE hex(OLD."last_status_tx_hash") END) FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_dispensers_delete AFTER DELETE ON dispensers
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'dispensers',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'asset_id',OLD."asset_id",'give_quantity',OLD."give_quantity",'give_quantity_normalized',OLD."give_quantity_normalized",'escrow_quantity',OLD."escrow_quantity",'give_remaining',OLD."give_remaining",'give_remaining_normalized',OLD."give_remaining_normalized",'satoshirate',OLD."satoshirate",'satoshirate_normalized',OLD."satoshirate_normalized",'status',OLD."status",'oracle_address_id',OLD."oracle_address_id",'dispense_count',OLD."dispense_count",'closed_block_index',OLD."closed_block_index",'origin_id',OLD."origin_id",'last_status_tx_hash',CASE WHEN OLD."last_status_tx_hash" IS NULL THEN NULL ELSE hex(OLD."last_status_tx_hash") END) FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_fairminters_insert AFTER INSERT ON fairminters
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'fairminters',json_object('tx_index',NEW."tx_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_fairminters_update AFTER UPDATE ON fairminters
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx_index" IS NOT NEW."tx_index" OR OLD."tx_hash" IS NOT NEW."tx_hash" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."source_id" IS NOT NEW."source_id" OR OLD."asset_id" IS NOT NEW."asset_id" OR OLD."asset_parent_id" IS NOT NEW."asset_parent_id" OR OLD."asset_longname" IS NOT NEW."asset_longname" OR OLD."description" IS NOT NEW."description" OR OLD."price" IS NOT NEW."price" OR OLD."quantity_by_price" IS NOT NEW."quantity_by_price" OR OLD."hard_cap" IS NOT NEW."hard_cap" OR OLD."burn_payment" IS NOT NEW."burn_payment" OR OLD."max_mint_per_tx" IS NOT NEW."max_mint_per_tx" OR OLD."premint_quantity" IS NOT NEW."premint_quantity" OR OLD."start_block" IS NOT NEW."start_block" OR OLD."end_block" IS NOT NEW."end_block" OR OLD."minted_asset_commission_int" IS NOT NEW."minted_asset_commission_int" OR OLD."soft_cap" IS NOT NEW."soft_cap" OR OLD."soft_cap_deadline_block" IS NOT NEW."soft_cap_deadline_block" OR OLD."lock_description" IS NOT NEW."lock_description" OR OLD."lock_quantity" IS NOT NEW."lock_quantity" OR OLD."divisible" IS NOT NEW."divisible" OR OLD."pre_minted" IS NOT NEW."pre_minted" OR OLD."status" IS NOT NEW."status" OR OLD."max_mint_per_address" IS NOT NEW."max_mint_per_address" OR OLD."mime_type" IS NOT NEW."mime_type" OR OLD."earned_quantity" IS NOT NEW."earned_quantity" OR OLD."paid_quantity" IS NOT NEW."paid_quantity" OR OLD."pool_quantity" IS NOT NEW."pool_quantity" OR OLD."lp_asset" IS NOT NEW."lp_asset")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'fairminters',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'asset_id',OLD."asset_id",'asset_parent_id',OLD."asset_parent_id",'asset_longname',OLD."asset_longname",'description',OLD."description",'price',OLD."price",'quantity_by_price',OLD."quantity_by_price",'hard_cap',OLD."hard_cap",'burn_payment',OLD."burn_payment",'max_mint_per_tx',OLD."max_mint_per_tx",'premint_quantity',OLD."premint_quantity",'start_block',OLD."start_block",'end_block',OLD."end_block",'minted_asset_commission_int',OLD."minted_asset_commission_int",'soft_cap',OLD."soft_cap",'soft_cap_deadline_block',OLD."soft_cap_deadline_block",'lock_description',OLD."lock_description",'lock_quantity',OLD."lock_quantity",'divisible',OLD."divisible",'pre_minted',OLD."pre_minted",'status',OLD."status",'max_mint_per_address',OLD."max_mint_per_address",'mime_type',OLD."mime_type",'earned_quantity',OLD."earned_quantity",'paid_quantity',OLD."paid_quantity",'pool_quantity',OLD."pool_quantity",'lp_asset',OLD."lp_asset") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_fairminters_delete AFTER DELETE ON fairminters
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'fairminters',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'asset_id',OLD."asset_id",'asset_parent_id',OLD."asset_parent_id",'asset_longname',OLD."asset_longname",'description',OLD."description",'price',OLD."price",'quantity_by_price',OLD."quantity_by_price",'hard_cap',OLD."hard_cap",'burn_payment',OLD."burn_payment",'max_mint_per_tx',OLD."max_mint_per_tx",'premint_quantity',OLD."premint_quantity",'start_block',OLD."start_block",'end_block',OLD."end_block",'minted_asset_commission_int',OLD."minted_asset_commission_int",'soft_cap',OLD."soft_cap",'soft_cap_deadline_block',OLD."soft_cap_deadline_block",'lock_description',OLD."lock_description",'lock_quantity',OLD."lock_quantity",'divisible',OLD."divisible",'pre_minted',OLD."pre_minted",'status',OLD."status",'max_mint_per_address',OLD."max_mint_per_address",'mime_type',OLD."mime_type",'earned_quantity',OLD."earned_quantity",'paid_quantity',OLD."paid_quantity",'pool_quantity',OLD."pool_quantity",'lp_asset',OLD."lp_asset") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_pools_insert AFTER INSERT ON pools
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'pools',json_object('asset_a_id',NEW."asset_a_id",'asset_b_id',NEW."asset_b_id"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_pools_update AFTER UPDATE ON pools
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."asset_a_id" IS NOT NEW."asset_a_id" OR OLD."asset_b_id" IS NOT NEW."asset_b_id" OR OLD."lp_asset" IS NOT NEW."lp_asset" OR OLD."pair" IS NOT NEW."pair" OR OLD."reserve_a" IS NOT NEW."reserve_a" OR OLD."reserve_b" IS NOT NEW."reserve_b" OR OLD."lp_supply" IS NOT NEW."lp_supply" OR OLD."price" IS NOT NEW."price" OR OLD."status" IS NOT NEW."status" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."updated_block_index" IS NOT NEW."updated_block_index")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'pools',json_object('asset_a_id',OLD."asset_a_id",'asset_b_id',OLD."asset_b_id"),json_object('asset_a_id',OLD."asset_a_id",'asset_b_id',OLD."asset_b_id",'lp_asset',OLD."lp_asset",'pair',OLD."pair",'reserve_a',OLD."reserve_a",'reserve_b',OLD."reserve_b",'lp_supply',OLD."lp_supply",'price',OLD."price",'status',OLD."status",'block_index',OLD."block_index",'updated_block_index',OLD."updated_block_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_pools_delete AFTER DELETE ON pools
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'pools',json_object('asset_a_id',OLD."asset_a_id",'asset_b_id',OLD."asset_b_id"),json_object('asset_a_id',OLD."asset_a_id",'asset_b_id',OLD."asset_b_id",'lp_asset',OLD."lp_asset",'pair',OLD."pair",'reserve_a',OLD."reserve_a",'reserve_b',OLD."reserve_b",'lp_supply',OLD."lp_supply",'price',OLD."price",'status',OLD."status",'block_index',OLD."block_index",'updated_block_index',OLD."updated_block_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bets_insert AFTER INSERT ON bets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bets',json_object('tx_index',NEW."tx_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bets_update AFTER UPDATE ON bets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx_index" IS NOT NEW."tx_index" OR OLD."tx_hash" IS NOT NEW."tx_hash" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."source_id" IS NOT NEW."source_id" OR OLD."feed_address_id" IS NOT NEW."feed_address_id" OR OLD."bet_type" IS NOT NEW."bet_type" OR OLD."deadline" IS NOT NEW."deadline" OR OLD."wager_quantity" IS NOT NEW."wager_quantity" OR OLD."wager_remaining" IS NOT NEW."wager_remaining" OR OLD."counterwager_quantity" IS NOT NEW."counterwager_quantity" OR OLD."counterwager_remaining" IS NOT NEW."counterwager_remaining" OR OLD."target_value" IS NOT NEW."target_value" OR OLD."leverage" IS NOT NEW."leverage" OR OLD."expiration" IS NOT NEW."expiration" OR OLD."expire_index" IS NOT NEW."expire_index" OR OLD."fee_fraction_int" IS NOT NEW."fee_fraction_int" OR OLD."status" IS NOT NEW."status")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bets',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'feed_address_id',OLD."feed_address_id",'bet_type',OLD."bet_type",'deadline',OLD."deadline",'wager_quantity',OLD."wager_quantity",'wager_remaining',OLD."wager_remaining",'counterwager_quantity',OLD."counterwager_quantity",'counterwager_remaining',OLD."counterwager_remaining",'target_value',OLD."target_value",'leverage',OLD."leverage",'expiration',OLD."expiration",'expire_index',OLD."expire_index",'fee_fraction_int',OLD."fee_fraction_int",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bets_delete AFTER DELETE ON bets
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bets',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'feed_address_id',OLD."feed_address_id",'bet_type',OLD."bet_type",'deadline',OLD."deadline",'wager_quantity',OLD."wager_quantity",'wager_remaining',OLD."wager_remaining",'counterwager_quantity',OLD."counterwager_quantity",'counterwager_remaining',OLD."counterwager_remaining",'target_value',OLD."target_value",'leverage',OLD."leverage",'expiration',OLD."expiration",'expire_index',OLD."expire_index",'fee_fraction_int',OLD."fee_fraction_int",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bet_matches_insert AFTER INSERT ON bet_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bet_matches',json_object('tx0_index',NEW."tx0_index",'tx1_index',NEW."tx1_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bet_matches_update AFTER UPDATE ON bet_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx0_index" IS NOT NEW."tx0_index" OR OLD."tx1_index" IS NOT NEW."tx1_index" OR OLD."tx0_hash" IS NOT NEW."tx0_hash" OR OLD."tx1_hash" IS NOT NEW."tx1_hash" OR OLD."tx0_address_id" IS NOT NEW."tx0_address_id" OR OLD."tx1_address_id" IS NOT NEW."tx1_address_id" OR OLD."feed_address_id" IS NOT NEW."feed_address_id" OR OLD."forward_quantity" IS NOT NEW."forward_quantity" OR OLD."backward_quantity" IS NOT NEW."backward_quantity" OR OLD."deadline" IS NOT NEW."deadline" OR OLD."target_value" IS NOT NEW."target_value" OR OLD."leverage" IS NOT NEW."leverage" OR OLD."initial_value" IS NOT NEW."initial_value" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."status" IS NOT NEW."status" OR OLD."tx0_bet_type" IS NOT NEW."tx0_bet_type" OR OLD."tx1_bet_type" IS NOT NEW."tx1_bet_type" OR OLD."fee_fraction_int" IS NOT NEW."fee_fraction_int" OR OLD."match_expire_index" IS NOT NEW."match_expire_index")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bet_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'feed_address_id',OLD."feed_address_id",'forward_quantity',OLD."forward_quantity",'backward_quantity',OLD."backward_quantity",'deadline',OLD."deadline",'target_value',OLD."target_value",'leverage',OLD."leverage",'initial_value',OLD."initial_value",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status",'tx0_bet_type',OLD."tx0_bet_type",'tx1_bet_type',OLD."tx1_bet_type",'fee_fraction_int',OLD."fee_fraction_int",'match_expire_index',OLD."match_expire_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_bet_matches_delete AFTER DELETE ON bet_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'bet_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'feed_address_id',OLD."feed_address_id",'forward_quantity',OLD."forward_quantity",'backward_quantity',OLD."backward_quantity",'deadline',OLD."deadline",'target_value',OLD."target_value",'leverage',OLD."leverage",'initial_value',OLD."initial_value",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status",'tx0_bet_type',OLD."tx0_bet_type",'tx1_bet_type',OLD."tx1_bet_type",'fee_fraction_int',OLD."fee_fraction_int",'match_expire_index',OLD."match_expire_index") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_insert AFTER INSERT ON rps
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps',json_object('tx_index',NEW."tx_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_update AFTER UPDATE ON rps
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx_index" IS NOT NEW."tx_index" OR OLD."tx_hash" IS NOT NEW."tx_hash" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."source_id" IS NOT NEW."source_id" OR OLD."possible_moves" IS NOT NEW."possible_moves" OR OLD."wager" IS NOT NEW."wager" OR OLD."move_random_hash" IS NOT NEW."move_random_hash" OR OLD."expiration" IS NOT NEW."expiration" OR OLD."expire_index" IS NOT NEW."expire_index" OR OLD."status" IS NOT NEW."status")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'possible_moves',OLD."possible_moves",'wager',OLD."wager",'move_random_hash',CASE WHEN OLD."move_random_hash" IS NULL THEN NULL ELSE hex(OLD."move_random_hash") END,'expiration',OLD."expiration",'expire_index',OLD."expire_index",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_delete AFTER DELETE ON rps
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps',json_object('tx_index',OLD."tx_index"),json_object('tx_index',OLD."tx_index",'tx_hash',CASE WHEN OLD."tx_hash" IS NULL THEN NULL ELSE hex(OLD."tx_hash") END,'block_index',OLD."block_index",'block_time',OLD."block_time",'source_id',OLD."source_id",'possible_moves',OLD."possible_moves",'wager',OLD."wager",'move_random_hash',CASE WHEN OLD."move_random_hash" IS NULL THEN NULL ELSE hex(OLD."move_random_hash") END,'expiration',OLD."expiration",'expire_index',OLD."expire_index",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_matches_insert AFTER INSERT ON rps_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps_matches',json_object('tx0_index',NEW."tx0_index",'tx1_index',NEW."tx1_index"),NULL FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_matches_update AFTER UPDATE ON rps_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1) AND (OLD."tx0_index" IS NOT NEW."tx0_index" OR OLD."tx1_index" IS NOT NEW."tx1_index" OR OLD."tx0_hash" IS NOT NEW."tx0_hash" OR OLD."tx1_hash" IS NOT NEW."tx1_hash" OR OLD."tx0_address_id" IS NOT NEW."tx0_address_id" OR OLD."tx1_address_id" IS NOT NEW."tx1_address_id" OR OLD."possible_moves" IS NOT NEW."possible_moves" OR OLD."wager" IS NOT NEW."wager" OR OLD."block_index" IS NOT NEW."block_index" OR OLD."block_time" IS NOT NEW."block_time" OR OLD."status" IS NOT NEW."status")
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'possible_moves',OLD."possible_moves",'wager',OLD."wager",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;

CREATE TRIGGER reorg_undo_rps_matches_delete AFTER DELETE ON rps_matches
WHEN EXISTS(SELECT 1 FROM reorg_undo_context WHERE singleton=1)
BEGIN
 INSERT INTO reorg_undo(block_index,table_name,row_key,before_row)
 SELECT block_index,'rps_matches',json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index"),json_object('tx0_index',OLD."tx0_index",'tx1_index',OLD."tx1_index",'tx0_hash',CASE WHEN OLD."tx0_hash" IS NULL THEN NULL ELSE hex(OLD."tx0_hash") END,'tx1_hash',CASE WHEN OLD."tx1_hash" IS NULL THEN NULL ELSE hex(OLD."tx1_hash") END,'tx0_address_id',OLD."tx0_address_id",'tx1_address_id',OLD."tx1_address_id",'possible_moves',OLD."possible_moves",'wager',OLD."wager",'block_index',OLD."block_index",'block_time',OLD."block_time",'status',OLD."status") FROM reorg_undo_context WHERE singleton=1;
END;
