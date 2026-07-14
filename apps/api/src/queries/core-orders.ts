import type { OrderMatchRow, OrderRow } from "@xcp/shared/records";
import { q } from "#api/db";

const ORDER_SELECT = `SELECT lower(hex(order_row.tx_hash)) tx_hash,order_row.block_index,order_row.block_time,
  source.address source,give_asset.asset give_asset,get_asset.asset get_asset,order_row.status,
  order_row.expiration,order_row.expire_index,
  CAST(order_row.give_quantity AS REAL)/(CASE WHEN give_asset.asset IN ('XCP','BTC') OR give_details.divisible=1 THEN 100000000.0 ELSE 1 END) give_quantity_normalized,
  CAST(order_row.get_quantity AS REAL)/(CASE WHEN get_asset.asset IN ('XCP','BTC') OR get_details.divisible=1 THEN 100000000.0 ELSE 1 END) get_quantity_normalized,
  CAST(order_row.give_remaining AS REAL)/(CASE WHEN give_asset.asset IN ('XCP','BTC') OR give_details.divisible=1 THEN 100000000.0 ELSE 1 END) give_remaining_normalized,
  CAST(order_row.get_remaining AS REAL)/(CASE WHEN get_asset.asset IN ('XCP','BTC') OR get_details.divisible=1 THEN 100000000.0 ELSE 1 END) get_remaining_normalized
FROM orders order_row
LEFT JOIN address_dictionary source ON source.address_id=order_row.source_id
LEFT JOIN asset_dictionary give_asset ON give_asset.asset_id=order_row.give_asset_id
LEFT JOIN asset_dictionary get_asset ON get_asset.asset_id=order_row.get_asset_id
LEFT JOIN assets give_details ON give_details.asset_id=order_row.give_asset_id
LEFT JOIN assets get_details ON get_details.asset_id=order_row.get_asset_id`;

export function listOrders(db: D1Database, limit: number, offset: number): Promise<OrderRow[]> {
  return q<OrderRow>(
    db,
    `${ORDER_SELECT} ORDER BY order_row.block_index DESC,order_row.tx_index DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}

export function listAssetOrders(db: D1Database, asset: string, limit: number, offset: number): Promise<OrderRow[]> {
  return q<OrderRow>(
    db,
    `${ORDER_SELECT}
      WHERE order_row.give_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
         OR order_row.get_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
      ORDER BY order_row.block_index DESC,order_row.tx_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

export function listOrderMatches(db: D1Database, limit: number, offset: number): Promise<OrderMatchRow[]> {
  return q<OrderMatchRow>(
    db,
    `SELECT lower(hex(match.tx0_hash))||'_'||lower(hex(match.tx1_hash)) id,
            match.block_index,match.block_time,lower(hex(match.tx0_hash)) tx0_hash,
            lower(hex(match.tx1_hash)) tx1_hash,a0.address tx0_address,a1.address tx1_address,
            forward.asset forward_asset,match.forward_quantity,backward.asset backward_asset,
            match.backward_quantity,match.status,
            CAST(match.forward_quantity AS REAL)/(CASE WHEN forward.asset IN ('XCP','BTC') OR forward_details.divisible=1 THEN 100000000.0 ELSE 1 END) forward_quantity_normalized,
            CAST(match.backward_quantity AS REAL)/(CASE WHEN backward.asset IN ('XCP','BTC') OR backward_details.divisible=1 THEN 100000000.0 ELSE 1 END) backward_quantity_normalized
       FROM order_matches match
       LEFT JOIN address_dictionary a0 ON a0.address_id=match.tx0_address_id
       LEFT JOIN address_dictionary a1 ON a1.address_id=match.tx1_address_id
       LEFT JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
       LEFT JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
       LEFT JOIN assets forward_details ON forward_details.asset_id=match.forward_asset_id
       LEFT JOIN assets backward_details ON backward_details.asset_id=match.backward_asset_id
      ORDER BY match.block_index DESC,match.tx0_index DESC,match.tx1_index DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}
