/** Counterparty repeats the whole output payment on every asset it releases.
 * Allocate once across the complete transaction, before any asset/address filter.
 * Core emits outputs in order and assets lexically within each output. A restart
 * or changed seller/buyer/payment therefore identifies the next output, including
 * repeated identical outputs. Amounts here are satoshis; fractions are allocation,
 * not additional on-chain payments. Raw btc_amount remains untouched.
 */
import { rebuildCoreAssetSignals } from "#api/indexer/core-asset-signals";
import { enqueueCoreAddressSignals } from "#api/indexer/core-address-signals";

export function dispenseAccountingSql(scope = "1=1"): string {
  return `WITH ordered AS (
    SELECT d.event_index,d.tx_index,d.dispense_index,a.asset,d.source_id,d.destination_id,d.btc_amount,
      MAX(0,CASE WHEN p.oracle_address_id IS NULL AND CAST(p.give_quantity AS REAL)>0
        THEN CAST(d.dispense_quantity AS REAL)*CAST(p.satoshirate AS REAL)/CAST(p.give_quantity AS REAL)
        ELSE CAST(d.btc_amount AS REAL) END) notional,
      LAG(a.asset) OVER tx previous_asset,LAG(d.source_id) OVER tx previous_source,
      LAG(d.destination_id) OVER tx previous_destination,LAG(d.btc_amount) OVER tx previous_payment
    FROM dispenses d JOIN asset_dictionary a ON a.asset_id=d.asset_id
    LEFT JOIN dispensers p ON p.tx_index=d.dispenser_tx_index
    WHERE ${scope}
    WINDOW tx AS (PARTITION BY d.tx_index ORDER BY d.dispense_index,d.event_index)
  ), grouped AS (
    SELECT *,SUM(CASE WHEN previous_asset IS NULL OR asset<=previous_asset
      OR source_id IS NOT previous_source OR destination_id IS NOT previous_destination
      OR btc_amount IS NOT previous_payment THEN 1 ELSE 0 END)
      OVER(PARTITION BY tx_index ORDER BY dispense_index,event_index ROWS UNBOUNDED PRECEDING) payment_group
    FROM ordered
  ), totals AS (
    SELECT *,SUM(notional) OVER payment total_notional,COUNT(*) OVER payment asset_count
    FROM grouped WINDOW payment AS (PARTITION BY tx_index,payment_group)
  )
  UPDATE dispenses SET quote_sats=CASE WHEN t.total_notional>0
    THEN t.notional*MIN(1.0,MAX(0,CAST(t.btc_amount AS REAL))/t.total_notional) ELSE 0 END,
    payment_asset_count=t.asset_count,payment_group=t.payment_group
  FROM totals t WHERE dispenses.event_index=t.event_index`;
}

/** Reprice all sibling rows after an upstream page boundary, never only the page.
 * Return all sibling assets so their signals are refreshed after late arrivals.
 */
export async function accountDispenseTransactions(db: D1Database, transactions: number[]): Promise<string[]> {
  const assets = new Set<string>();
  for (const tx of new Set(transactions)) {
    await db.prepare(dispenseAccountingSql("d.tx_index=?")).bind(tx).run();
    const rows = await db
      .prepare(
        `SELECT DISTINCT a.asset FROM dispenses d
      JOIN asset_dictionary a ON a.asset_id=d.asset_id WHERE d.tx_index=?`,
      )
      .bind(tx)
      .all<{ asset: string }>();
    for (const row of rows.results) assets.add(row.asset);
  }
  return [...assets];
}

/** Recover old-Worker writes during deployment. The durable worklist survives a
 * failure after allocation but before dependent projections have been queued. */
export async function repairUnaccountedDispenses(db: D1Database): Promise<void> {
  const saved = await db
    .prepare("SELECT value FROM core_state WHERE key='dispense_accounting_pending'")
    .first<{ value: string }>();
  const txs: number[] = saved
    ? JSON.parse(saved.value)
    : (
        await db
          .prepare("SELECT DISTINCT tx_index FROM dispenses WHERE payment_asset_count=0 ORDER BY tx_index LIMIT 25")
          .all<{ tx_index: number }>()
      ).results.map((row) => row.tx_index);
  if (!txs.length) return;
  await db
    .prepare(
      `INSERT INTO core_state(key,value) VALUES('dispense_accounting_pending',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .bind(JSON.stringify(txs))
    .run();
  const assets = await accountDispenseTransactions(db, txs);
  await rebuildCoreAssetSignals(db, assets);
  const addresses = await db
    .prepare(
      `SELECT DISTINCT a.address FROM dispenses d
    LEFT JOIN dispensers p ON p.tx_index=d.dispenser_tx_index
    JOIN address_dictionary a ON a.address_id IN (d.source_id,d.destination_id,p.origin_id)
    WHERE d.tx_index IN (${txs.map(() => "?").join(",")})`,
    )
    .bind(...txs)
    .all<{ address: string }>();
  await enqueueCoreAddressSignals(
    db,
    addresses.results.map((row) => row.address),
    assets,
  );
  await db.batch([
    db.prepare("DELETE FROM cache"),
    db.prepare(`DELETE FROM core_state WHERE key IN
      ('dispense_accounting_pending','trades_cur_dispense_payments','prices_synced_blk','usd_cur')`),
  ]);
}
