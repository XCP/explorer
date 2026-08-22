import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const FULL_REPAIR_INTERVAL = 1_008;

const isBitcoinAddress = (address: string) =>
  address.startsWith("1") || address.startsWith("3") || address.toLowerCase().startsWith("bc1");

const ACTIVITY_QUERIES = [
  `SELECT min(block_index) first_block,max(block_index) last_block FROM sends
    WHERE source_id=?1 OR destination_id=?1 OR source_address_id=?1 OR destination_address_id=?1`,
  `SELECT min(block_index) first_block,max(block_index) last_block FROM dispenses
    WHERE source_id=?1 OR destination_id=?1`,
  `SELECT min(block_index) first_block,max(block_index) last_block FROM issuances WHERE issuer_id=?1`,
  `SELECT min(block_index) first_block,max(block_index) last_block FROM fairmints WHERE source_id=?1`,
  `SELECT min(block_index) first_block,max(block_index) last_block FROM order_matches
    WHERE tx0_address_id=?1 OR tx1_address_id=?1`,
  `SELECT min(block_index) first_block,max(block_index) last_block FROM dispensers
    WHERE source_id=?1 OR origin_id=?1`,
] as const;

// The DO UPDATE carries a WHERE guard so the repair lane skips rows whose signals are unchanged —
// the weekly full-population cycle recycles ~500k addresses and nearly all are historically inert.
// Every column here is absolute (block numbers, counts, flags), so unchanged history compares equal.
const UPSERT = `INSERT INTO address_signals(
  address_id,first_block,last_block,out_peers,in_peers,dispense_btc,dispenses,dividends,
  assets_issued,assets_controlled,locked_assets,btc_spent,btc_fees,assets_held,assets_received,
  survived_assets,assets_distributed,assets_hits,clean_dispense_btc,clean_btc_spent,
  is_exchange,is_deposit,is_burn,assets_burned,disp_trust,likely_service,dex_trades,
  stamps_created,stamps_collected,src20_deploys,is_btns_user)
WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1),
holding AS (SELECT count(DISTINCT asset_id) assets_held FROM balances
  WHERE address_id=(SELECT address_id FROM identity) AND CAST(quantity AS INTEGER)>0),
creator AS (
  SELECT sum(CASE WHEN holders>=2 THEN 1 ELSE 0 END) distributed,
    sum(CASE WHEN holders>=10 THEN 1 ELSE 0 END) survived,
    sum(CASE WHEN holders>=50 THEN 1 ELSE 0 END) hits,
    sum(CASE WHEN asset.locked=1 AND holders>=2 THEN 1 ELSE 0 END) locked_assets
  FROM assets asset LEFT JOIN asset_signals signal ON signal.asset_id=asset.asset_id
  WHERE asset.issuer_id=(SELECT address_id FROM identity)
),
controlled AS (
  SELECT count(*) assets_controlled FROM assets
  WHERE issuer_id=(SELECT address_id FROM identity) OR owner_id=(SELECT address_id FROM identity)
),
earned_items AS (
  SELECT item.btc_amount,item.asset_id,item.block_index
  FROM dispensers dispenser INDEXED BY idx_dispensers_origin
  JOIN dispenses item INDEXED BY idx_dispenses_dispenser ON item.dispenser_tx_index=dispenser.tx_index
  WHERE dispenser.origin_id=(SELECT address_id FROM identity)
  UNION ALL
  SELECT item.btc_amount,item.asset_id,item.block_index
  FROM dispenses item INDEXED BY idx_dispenses_source
  LEFT JOIN dispensers dispenser ON dispenser.tx_index=item.dispenser_tx_index
  WHERE item.source_id=(SELECT address_id FROM identity) AND dispenser.origin_id IS NULL
),
earned AS (
  SELECT count(*) dispenses,coalesce(sum(CAST(item.btc_amount AS REAL))/1e8,0) btc,
    coalesce(sum(CASE WHEN coalesce(signal.low_quality,0)=0 THEN CAST(item.btc_amount AS REAL) END)/1e8,0) clean
  FROM earned_items item LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
),
spent AS (
  SELECT coalesce(sum(CAST(item.btc_amount AS REAL))/1e8,0) btc,
    coalesce(sum(CASE WHEN coalesce(signal.low_quality,0)=0 THEN CAST(item.btc_amount AS REAL) END)/1e8,0) clean
  FROM dispenses item LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
  WHERE item.destination_id=(SELECT address_id FROM identity)
),
infra AS (SELECT
  EXISTS(SELECT 1 FROM curated item JOIN address_dictionary address ON address.address=item.key
    WHERE item.kind='exchange' AND address.address_id=(SELECT address_id FROM identity)) exchange_flag,
  EXISTS(SELECT 1 FROM curated item JOIN address_dictionary address ON address.address=item.key
    WHERE item.kind='burn' AND address.address_id=(SELECT address_id FROM identity)) burn_flag),
stamp AS (SELECT
  count(DISTINCT CASE WHEN tag.tag='stamp' THEN asset.asset_id END) created,
  count(DISTINCT CASE WHEN tag.tag='src20_deploy' THEN asset.asset_id END) src20
  FROM assets asset JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
  JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
  JOIN tags tag ON tag.entity_id=entity.entity_id AND tag.tag IN('stamp','src20_deploy')
  WHERE asset.issuer_id=(SELECT address_id FROM identity)),
collected AS (SELECT count(DISTINCT balance.asset_id) stamps FROM balances balance
  JOIN asset_dictionary dictionary ON dictionary.asset_id=balance.asset_id
  JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
  JOIN tags tag ON tag.entity_id=entity.entity_id AND tag.tag='stamp'
  WHERE balance.address_id=(SELECT address_id FROM identity) AND CAST(balance.quantity AS INTEGER)>0)
SELECT identity.address_id,?2,coalesce(?3,0),
  (SELECT count(DISTINCT coalesce(destination_address_id,destination_id)) FROM sends
    WHERE source_id=identity.address_id OR source_address_id=identity.address_id),
  (SELECT count(DISTINCT coalesce(source_address_id,source_id)) FROM sends
    WHERE destination_id=identity.address_id OR destination_address_id=identity.address_id),
  earned.btc,earned.dispenses,
  (SELECT count(*) FROM dividends WHERE source_id=identity.address_id),
  (SELECT count(*) FROM issuances WHERE issuer_id=identity.address_id),controlled.assets_controlled,
  coalesce(creator.locked_assets,0),
  spent.btc,coalesce((SELECT sum(CAST(fee AS REAL))/1e8 FROM transactions WHERE source_id=identity.address_id),0),
  holding.assets_held,(SELECT count(DISTINCT asset_id) FROM sends
    WHERE destination_id=identity.address_id OR destination_address_id=identity.address_id),
  coalesce(creator.survived,0),coalesce(creator.distributed,0),coalesce(creator.hits,0),earned.clean,spent.clean,
  infra.exchange_flag,
  CASE WHEN infra.exchange_flag=0 AND holding.assets_held=0
    AND (SELECT count(DISTINCT coalesce(destination_address_id,destination_id)) FROM sends
      WHERE source_id=identity.address_id OR source_address_id=identity.address_id)=1
    AND EXISTS(SELECT 1 FROM sends send JOIN address_signals signal
      ON signal.address_id=coalesce(send.destination_address_id,send.destination_id)
      WHERE (send.source_id=identity.address_id OR send.source_address_id=identity.address_id)
        AND signal.is_exchange=1) THEN 1 ELSE 0 END,
  infra.burn_flag,
  (SELECT count(DISTINCT send.asset_id) FROM sends send JOIN address_signals burn
      ON burn.address_id=coalesce(send.destination_address_id,send.destination_id)
    LEFT JOIN asset_signals asset ON asset.asset_id=send.asset_id
    WHERE (send.source_id=identity.address_id OR send.source_address_id=identity.address_id)
      AND burn.is_burn=1 AND coalesce(asset.low_quality,0)=0),
  coalesce((SELECT 2*ln(1+(max(block_index)-min(block_index))/4320.0)+1.5*ln(1+count(*))
    FROM (
      SELECT block_index FROM dispensers INDEXED BY idx_dispensers_origin WHERE origin_id=identity.address_id
      UNION ALL
      SELECT block_index FROM dispensers INDEXED BY idx_dispensers_source
      WHERE source_id=identity.address_id AND origin_id IS NULL
    )),0),
  0,
  (SELECT count(*) FROM order_matches WHERE tx0_address_id=identity.address_id)
    +(SELECT count(*) FROM order_matches WHERE tx1_address_id=identity.address_id),
  stamp.created,collected.stamps,stamp.src20,
  EXISTS(SELECT 1 FROM broadcasts WHERE source_id=identity.address_id AND btns=1)
FROM identity CROSS JOIN holding CROSS JOIN creator CROSS JOIN controlled CROSS JOIN earned CROSS JOIN spent CROSS JOIN infra CROSS JOIN stamp CROSS JOIN collected
WHERE 1 ON CONFLICT(address_id) DO UPDATE SET
  first_block=excluded.first_block,last_block=excluded.last_block,out_peers=excluded.out_peers,in_peers=excluded.in_peers,
  dispense_btc=excluded.dispense_btc,dispenses=excluded.dispenses,dividends=excluded.dividends,
  assets_issued=excluded.assets_issued,assets_controlled=excluded.assets_controlled,
  locked_assets=excluded.locked_assets,btc_spent=excluded.btc_spent,
  btc_fees=excluded.btc_fees,assets_held=excluded.assets_held,assets_received=excluded.assets_received,
  survived_assets=excluded.survived_assets,assets_distributed=excluded.assets_distributed,assets_hits=excluded.assets_hits,
  clean_dispense_btc=excluded.clean_dispense_btc,clean_btc_spent=excluded.clean_btc_spent,
  is_exchange=excluded.is_exchange,is_deposit=excluded.is_deposit,is_burn=excluded.is_burn,
  assets_burned=excluded.assets_burned,disp_trust=excluded.disp_trust,likely_service=excluded.likely_service,
  dex_trades=excluded.dex_trades,stamps_created=excluded.stamps_created,stamps_collected=excluded.stamps_collected,
  src20_deploys=excluded.src20_deploys,is_btns_user=excluded.is_btns_user
WHERE address_signals.first_block IS NOT excluded.first_block
  OR address_signals.last_block IS NOT excluded.last_block
  OR address_signals.out_peers IS NOT excluded.out_peers OR address_signals.in_peers IS NOT excluded.in_peers
  OR address_signals.dispense_btc IS NOT excluded.dispense_btc OR address_signals.dispenses IS NOT excluded.dispenses
  OR address_signals.dividends IS NOT excluded.dividends
  OR address_signals.assets_issued IS NOT excluded.assets_issued
  OR address_signals.assets_controlled IS NOT excluded.assets_controlled
  OR address_signals.locked_assets IS NOT excluded.locked_assets
  OR address_signals.btc_spent IS NOT excluded.btc_spent OR address_signals.btc_fees IS NOT excluded.btc_fees
  OR address_signals.assets_held IS NOT excluded.assets_held
  OR address_signals.assets_received IS NOT excluded.assets_received
  OR address_signals.survived_assets IS NOT excluded.survived_assets
  OR address_signals.assets_distributed IS NOT excluded.assets_distributed
  OR address_signals.assets_hits IS NOT excluded.assets_hits
  OR address_signals.clean_dispense_btc IS NOT excluded.clean_dispense_btc
  OR address_signals.clean_btc_spent IS NOT excluded.clean_btc_spent
  OR address_signals.is_exchange IS NOT excluded.is_exchange
  OR address_signals.is_deposit IS NOT excluded.is_deposit OR address_signals.is_burn IS NOT excluded.is_burn
  OR address_signals.assets_burned IS NOT excluded.assets_burned
  OR address_signals.disp_trust IS NOT excluded.disp_trust
  OR address_signals.likely_service IS NOT excluded.likely_service
  OR address_signals.dex_trades IS NOT excluded.dex_trades
  OR address_signals.stamps_created IS NOT excluded.stamps_created
  OR address_signals.stamps_collected IS NOT excluded.stamps_collected
  OR address_signals.src20_deploys IS NOT excluded.src20_deploys
  OR address_signals.is_btns_user IS NOT excluded.is_btns_user`;

interface AddressSignalRebuild {
  processed: number;
  changedAddressIds: number[];
}

async function rebuildCoreAddressSignalsWithChanges(
  db: D1Database,
  addresses: Iterable<string>,
): Promise<AddressSignalRebuild> {
  // Counterparty also uses txid:vout keys as balance locations. They remain first-class dictionary identities,
  // but they are UTXOs rather than addresses and must not receive address reputation projections.
  const unique = [...new Set(addresses)].filter(isBitcoinAddress);
  const changedAddressIds: number[] = [];
  // Keep the small multi-table activity query separate from the large projection UPSERT. Combining them can
  // exceed D1's compound-SELECT limit, while each address remains independently replay-safe.
  for (const address of unique) {
    const identity = await db
      .prepare(`SELECT address_id FROM address_dictionary WHERE address=?`)
      .bind(address)
      .first<{ address_id: number }>();
    if (!identity) continue;
    // One batch = one Worker subrequest for all six activity reads. The sequential form cost ~8
    // subrequests per address, which capped a drain step near 110 addresses before hitting the
    // 1,000-subrequest invocation limit (and killed the whole maintenance lane when exceeded).
    const bounds = await db.batch<{ first_block: number | null; last_block: number | null }>(
      ACTIVITY_QUERIES.map((query) => db.prepare(query).bind(identity.address_id)),
    );
    const activity = bounds.flatMap((result) => result.results ?? []);
    const firstBlocks = activity.flatMap((row) => (row.first_block === null ? [] : [row.first_block]));
    const lastBlocks = activity.flatMap((row) => (row.last_block === null ? [] : [row.last_block]));
    const firstBlock = firstBlocks.length > 0 ? Math.min(...firstBlocks) : null;
    const lastBlock = lastBlocks.length > 0 ? Math.max(...lastBlocks) : null;
    const changed = await db
      .prepare(`${UPSERT} RETURNING address_id`)
      .bind(address, firstBlock, lastBlock)
      .first<{ address_id: number }>();
    if (changed) changedAddressIds.push(changed.address_id);
  }
  return { processed: unique.length, changedAddressIds };
}

export async function rebuildCoreAddressSignals(db: D1Database, addresses: Iterable<string>): Promise<number> {
  return (await rebuildCoreAddressSignalsWithChanges(db, addresses)).processed;
}

async function queuedIds(db: D1Database): Promise<number[]> {
  try {
    const value = await db
      .prepare(`SELECT value FROM core_state WHERE key='address_signals_queue'`)
      .first<{ value: string }>();
    const parsed: unknown = JSON.parse(value?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

async function stageHeldAssetSignals(db: D1Database, addressIds: number[]): Promise<void> {
  for (let index = 0; index < addressIds.length; index += 90) {
    const chunk = addressIds.slice(index, index + 90);
    await db
      .prepare(
        `INSERT INTO asset_signal_dependency_dirty(asset_id)
         SELECT DISTINCT asset_id FROM balances
         WHERE address_id IN (${chunk.map(() => "?").join(",")}) AND CAST(quantity AS INTEGER)>0
         ON CONFLICT(asset_id) DO NOTHING`,
      )
      .bind(...chunk)
      .run();
  }
}

async function stageNamedAssetSignals(db: D1Database, assets: Iterable<string>): Promise<void> {
  const names = [...new Set(assets)].filter(Boolean);
  for (let index = 0; index < names.length; index += 90) {
    const chunk = names.slice(index, index + 90);
    await db
      .prepare(
        `INSERT INTO asset_signal_dependency_dirty(asset_id)
         SELECT asset_id FROM asset_dictionary WHERE asset IN (${chunk.map(() => "?").join(",")})
         ON CONFLICT(asset_id) DO NOTHING`,
      )
      .bind(...chunk)
      .run();
  }
}

async function flushHeldAssetSignals(db: D1Database): Promise<void> {
  const pending = await db.prepare(`SELECT 1 pending FROM asset_signal_dependency_dirty LIMIT 1`).first();
  if (!pending) return;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO asset_signal_dirty(asset_id) SELECT asset_id FROM asset_signal_dependency_dirty`),
    db.prepare(`DELETE FROM asset_signal_dependency_dirty`),
  ]);
}

export async function enqueueCoreAddressSignals(
  db: D1Database,
  addresses: Iterable<string>,
  affectedAssets: Iterable<string> = [],
): Promise<void> {
  const names = [...new Set(addresses)].filter(Boolean);
  await stageNamedAssetSignals(db, affectedAssets);
  if (names.length === 0) return;
  // D1 caps a statement near 100 bound variables — resolve the ids in slices.
  const ids: number[] = [];
  for (let index = 0; index < names.length; index += 90) {
    const chunk = names.slice(index, index + 90);
    const rows = await db
      .prepare(`SELECT address_id FROM address_dictionary WHERE address IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ address_id: number }>();
    ids.push(...rows.results.map((row) => row.address_id));
  }
  await setCoreState(db, "address_signals_queue", JSON.stringify([...new Set([...(await queuedIds(db)), ...ids])]));
}

// 150/step: the queue is the repair lane (the 2026-07-29 fork-gap repair queued 54k receive-only
// addresses that had never been swept in the canonical era) — at 60/step a full-population cycle
// took ~18 days, which is how the gap stayed invisible. ~9 sequential D1 reads per address keeps
// 150 well inside a maintenance tick.
export async function runCoreAddressSignalsStep(db: D1Database, limit = 150, force = false) {
  const queue = await queuedIds(db);
  if (queue.length > 0) {
    const todo = queue.slice(0, limit);
    // D1 caps a statement near 100 bound variables — resolve the ids in slices.
    const addresses: string[] = [];
    for (let index = 0; index < todo.length; index += 90) {
      const chunk = todo.slice(index, index + 90);
      const rows = await db
        .prepare(`SELECT address FROM address_dictionary WHERE address_id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ address: string }>();
      addresses.push(...rows.results.map((row) => row.address));
    }
    const rebuilt = await rebuildCoreAddressSignalsWithChanges(db, addresses);
    // Asset holder-community fields read address_signals. Propagate a queued address refresh to
    // the assets whose address projection actually changed. Stage dependencies until the address
    // queue completes so popular assets are inserted into the main work queue only once.
    await stageHeldAssetSignals(db, rebuilt.changedAddressIds);
    const remaining = queue.slice(todo.length);
    await setCoreState(db, "address_signals_queue", JSON.stringify(remaining));
    if (remaining.length === 0 && (await getCoreStateInt(db, "address_signals_cursor")) === 0)
      await flushHeldAssetSignals(db);
    return {
      processed: rebuilt.processed,
      queueRemaining: remaining.length,
      cycleComplete: false,
    };
  }
  const cursor = await getCoreStateInt(db, "address_signals_cursor");
  // Recover a staged queue left by a Worker interruption after its address queue committed empty.
  if (cursor === 0) await flushHeldAssetSignals(db);
  if (cursor === 0 && !force && (await getCoreStateInt(db, "address_signals_cycles")) > 0) {
    const tip =
      Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
    const completed = await getCoreStateInt(db, "address_signals_completed_block");
    if (tip - completed < FULL_REPAIR_INTERVAL) return { processed: 0, cursor: 0, cycleComplete: true };
  }
  const rows = await db
    .prepare(
      `SELECT address_id,address FROM address_dictionary
       WHERE address_id>? AND (address GLOB '1*' OR address GLOB '3*' OR lower(address) LIKE 'bc1%')
       ORDER BY address_id LIMIT ?`,
    )
    .bind(cursor, limit)
    .all<{ address_id: number; address: string }>();
  if (rows.results.length === 0) {
    await setCoreState(db, "address_signals_cursor", 0);
    await setCoreState(db, "address_signals_cycles", (await getCoreStateInt(db, "address_signals_cycles")) + 1);
    const tip =
      Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
    await setCoreState(db, "address_signals_completed_block", tip);
    await flushHeldAssetSignals(db);
    return { processed: 0, cursor: 0, cycleComplete: true };
  }
  const rebuilt = await rebuildCoreAddressSignalsWithChanges(
    db,
    rows.results.map((row) => row.address),
  );
  await stageHeldAssetSignals(db, rebuilt.changedAddressIds);
  const next = rows.results.at(-1)?.address_id ?? cursor;
  await setCoreState(db, "address_signals_cursor", next);
  return { processed: rebuilt.processed, cursor: next, cycleComplete: false };
}
